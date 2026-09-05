Option Explicit

Dim shell, fileSystem, scriptDirectory, controllerPath, systemRoot, powershellPath, command, argument
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

scriptDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
controllerPath = fileSystem.BuildPath(scriptDirectory, "Blockwright-ControlCenter.ps1")
systemRoot = shell.ExpandEnvironmentStrings("%SystemRoot%")
powershellPath = fileSystem.BuildPath(systemRoot, "System32\WindowsPowerShell\v1.0\powershell.exe")
command = QuoteArgument(powershellPath) & " -NoLogo -NoProfile -WindowStyle Hidden -STA -ExecutionPolicy Bypass -File " & QuoteArgument(controllerPath)

For Each argument In WScript.Arguments
    command = command & " " & QuoteArgument(CStr(argument))
Next

shell.Run command, 0, False

Function QuoteArgument(value)
    QuoteArgument = Chr(34) & Replace(value, Chr(34), "\" & Chr(34)) & Chr(34)
End Function
