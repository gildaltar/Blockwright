using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;

namespace Blockwright.Windows
{
    internal static class Program
    {
        private const int MissingPayloadExitCode = 10;
        private const int LaunchFailureExitCode = 11;
        private const uint ErrorIcon = 0x00000010;
        private static readonly object StandardOutputLock = new object();
        private static readonly object StandardErrorLock = new object();
        private static readonly Stream StandardOutput = OpenStandardStream(false);
        private static readonly Stream StandardError = OpenStandardStream(true);
        private static readonly Encoding StandardEncoding = GetStandardEncoding();

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern int MessageBox(IntPtr window, string text, string caption, uint type);

        [STAThread]
        private static int Main(string[] arguments)
        {
            try
            {
                string executablePath = Path.GetFullPath(Assembly.GetExecutingAssembly().Location);
                string installRoot = Path.GetDirectoryName(executablePath);
                if (String.IsNullOrWhiteSpace(installRoot))
                {
                    return ReportFailure("Blockwright could not resolve the directory containing Blockwright.exe.", MissingPayloadExitCode);
                }

                string controllerPath = Path.Combine(installRoot, "scripts", "windows", "Blockwright-ControlCenter.ps1");
                if (!File.Exists(controllerPath))
                {
                    return ReportFailure("The Blockwright Control Center is missing from this installation:\r\n\r\n" + controllerPath, MissingPayloadExitCode);
                }

                string windowsDirectory = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
                string powerShellPath = Path.Combine(windowsDirectory, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
                if (String.IsNullOrWhiteSpace(windowsDirectory) || !File.Exists(powerShellPath))
                {
                    return ReportFailure("Windows PowerShell 5.1 could not be found at its trusted system location.", MissingPayloadExitCode);
                }

                var childArguments = new List<string>
                {
                    "-NoLogo",
                    "-NoProfile",
                    "-WindowStyle",
                    "Hidden",
                    "-STA",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                    controllerPath,
                };
                foreach (string argument in arguments)
                {
                    childArguments.Add(MapActivationArgument(argument));
                }

                var startInfo = new ProcessStartInfo
                {
                    FileName = powerShellPath,
                    Arguments = BuildCommandLine(childArguments),
                    WorkingDirectory = installRoot,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                };

                using (var child = new Process { StartInfo = startInfo })
                {
                    child.OutputDataReceived += delegate(object sender, DataReceivedEventArgs eventArgs)
                    {
                        if (eventArgs.Data != null) ForwardStandardLine(eventArgs.Data, false);
                    };
                    child.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs eventArgs)
                    {
                        if (eventArgs.Data != null) ForwardStandardLine(eventArgs.Data, true);
                    };
                    if (!child.Start())
                    {
                        return ReportFailure("Windows did not start the Blockwright Control Center process.", LaunchFailureExitCode);
                    }
                    child.BeginOutputReadLine();
                    child.BeginErrorReadLine();
                    child.WaitForExit();
                    // A second wait after asynchronous stream reads ensures the
                    // final output events have drained before the launcher exits.
                    child.WaitForExit();
                    return child.ExitCode;
                }
            }
            catch (Exception error)
            {
                return ReportFailure("Blockwright could not start its Control Center.\r\n\r\n" + error.Message, LaunchFailureExitCode);
            }
        }

        private static string MapActivationArgument(string argument)
        {
            if (String.Equals(argument, "--open", StringComparison.OrdinalIgnoreCase)) return "-Open";
            if (String.Equals(argument, "--new-build", StringComparison.OrdinalIgnoreCase)) return "-NewBuild";
            if (String.Equals(argument, "--settings", StringComparison.OrdinalIgnoreCase)) return "-OpenSettings";
            if (String.Equals(argument, "--diagnostics", StringComparison.OrdinalIgnoreCase)) return "-OpenDiagnostics";
            if (String.Equals(argument, "--open-schematic", StringComparison.OrdinalIgnoreCase)) return "-OpenSchematic";
            return argument;
        }

        private static string BuildCommandLine(IEnumerable<string> arguments)
        {
            var commandLine = new StringBuilder();
            foreach (string argument in arguments)
            {
                if (commandLine.Length > 0) commandLine.Append(' ');
                commandLine.Append(QuoteCommandLineArgument(argument ?? String.Empty));
            }
            return commandLine.ToString();
        }

        // Implements the CommandLineToArgvW-compatible escaping used by native
        // ProcessStartInfo.Arguments. Quotes and trailing backslashes therefore
        // arrive at powershell.exe as data rather than changing the command line.
        private static string QuoteCommandLineArgument(string value)
        {
            if (value.Length > 0 && value.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0)
            {
                return value;
            }

            var quoted = new StringBuilder();
            quoted.Append('"');
            int backslashes = 0;
            foreach (char character in value)
            {
                if (character == '\\')
                {
                    backslashes += 1;
                    continue;
                }
                if (character == '"')
                {
                    quoted.Append('\\', (backslashes * 2) + 1);
                    quoted.Append('"');
                    backslashes = 0;
                    continue;
                }
                quoted.Append('\\', backslashes);
                quoted.Append(character);
                backslashes = 0;
            }
            quoted.Append('\\', backslashes * 2);
            quoted.Append('"');
            return quoted.ToString();
        }

        private static Stream OpenStandardStream(bool error)
        {
            try { return error ? Console.OpenStandardError() : Console.OpenStandardOutput(); }
            catch { return Stream.Null; }
        }

        private static Encoding GetStandardEncoding()
        {
            try { return Console.OutputEncoding; }
            catch { return Encoding.UTF8; }
        }

        private static void ForwardStandardLine(string line, bool error)
        {
            try
            {
                byte[] bytes = StandardEncoding.GetBytes(line + Environment.NewLine);
                Stream stream = error ? StandardError : StandardOutput;
                object streamLock = error ? StandardErrorLock : StandardOutputLock;
                lock (streamLock)
                {
                    stream.Write(bytes, 0, bytes.Length);
                    stream.Flush();
                }
            }
            catch
            {
                // Interactive WinExe launches normally have no inherited
                // standard handles. Output forwarding is best-effort there.
            }
        }

        private static int ReportFailure(string message, int exitCode)
        {
            ForwardStandardLine(message, true);

            if (!String.Equals(Environment.GetEnvironmentVariable("BLOCKWRIGHT_LAUNCHER_NO_DIALOG"), "1", StringComparison.Ordinal))
            {
                try { MessageBox(IntPtr.Zero, message, "Blockwright could not start", ErrorIcon); }
                catch { }
            }
            return exitCode;
        }
    }
}
