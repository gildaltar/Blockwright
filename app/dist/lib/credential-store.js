import { BoundedPowerShellRunner } from "./bounded-powershell.js";
import { ManagedTaskError, sanitizeDiagnosticText } from "./task-contract.js";
export class CredentialStoreError extends ManagedTaskError {
    constructor(input) {
        super({
            ...input,
            retrySafe: input.retrySafe ?? false,
            retryReason: input.retryReason ?? "Retrying cannot change the credential-store boundary.",
            component: "credential-store",
        });
        this.name = "CredentialStoreError";
    }
}
const CREDENTIAL_TARGET_PREFIX = "Blockwright/";
const WINDOWS_CREDENTIAL_MANAGER_SCRIPT = String.raw `
$ErrorActionPreference = 'Stop'
$inputText = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($inputText)) { throw 'Credential operation input is required.' }
$request = $inputText | ConvertFrom-Json

$nativeSource = @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

public static class BlockwrightCredentialNative {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public UInt32 Flags;
    public UInt32 Type;
    [MarshalAs(UnmanagedType.LPWStr)] public string TargetName;
    [MarshalAs(UnmanagedType.LPWStr)] public string Comment;
    public FILETIME LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist;
    public UInt32 AttributeCount;
    public IntPtr Attributes;
    [MarshalAs(UnmanagedType.LPWStr)] public string TargetAlias;
    [MarshalAs(UnmanagedType.LPWStr)] public string UserName;
  }

  [DllImport("Advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredWrite(ref CREDENTIAL credential, UInt32 flags);

  [DllImport("Advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credential);

  [DllImport("Advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredDelete(string target, UInt32 type, UInt32 flags);

  [DllImport("Advapi32.dll", EntryPoint = "CredEnumerateW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredEnumerate(string filter, UInt32 flags, out UInt32 count, out IntPtr credentials);

  [DllImport("Advapi32.dll", SetLastError = false)]
  public static extern void CredFree(IntPtr buffer);
}
'@
Add-Type -TypeDefinition $nativeSource | Out-Null

function Write-Result([object]$value) {
  $value | ConvertTo-Json -Compress -Depth 4
}

$type = [uint32]1
$notFound = 1168
$target = if ($null -ne $request.target) { [string]$request.target } else { '' }

switch ([string]$request.operation) {
  'set' {
    $secretUtf8 = [Convert]::FromBase64String([string]$request.secretUtf8Base64)
    $secretText = [Text.Encoding]::UTF8.GetString($secretUtf8)
    $blob = [Text.Encoding]::Unicode.GetBytes($secretText)
    if ($blob.Length -lt 2 -or $blob.Length -gt 2560) { throw 'Credential value exceeds the supported Windows Credential Manager boundary.' }
    $pointer = [Runtime.InteropServices.Marshal]::AllocHGlobal($blob.Length)
    try {
      [Runtime.InteropServices.Marshal]::Copy($blob, 0, $pointer, $blob.Length)
      $credential = New-Object BlockwrightCredentialNative+CREDENTIAL
      $credential.Type = $type
      $credential.TargetName = $target
      $credential.CredentialBlobSize = [uint32]$blob.Length
      $credential.CredentialBlob = $pointer
      $credential.Persist = [uint32]2
      $credential.UserName = 'Blockwright'
      if (-not [BlockwrightCredentialNative]::CredWrite([ref]$credential, 0)) {
        throw ('CredWrite failed with Windows error ' + [Runtime.InteropServices.Marshal]::GetLastWin32Error())
      }
      Write-Result ([pscustomobject]@{ ok = $true; exists = $true })
    } finally {
      if ($pointer -ne [IntPtr]::Zero) {
        $zero = New-Object byte[] $blob.Length
        [Runtime.InteropServices.Marshal]::Copy($zero, 0, $pointer, $zero.Length)
        [Runtime.InteropServices.Marshal]::FreeHGlobal($pointer)
        [Array]::Clear($zero, 0, $zero.Length)
      }
      [Array]::Clear($blob, 0, $blob.Length)
      [Array]::Clear($secretUtf8, 0, $secretUtf8.Length)
      $secretText = $null
    }
  }
  'read' {
    $pointer = [IntPtr]::Zero
    if (-not [BlockwrightCredentialNative]::CredRead($target, $type, 0, [ref]$pointer)) {
      $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      if ($errorCode -eq $notFound) { Write-Result ([pscustomobject]@{ ok = $true; exists = $false }); break }
      throw ('CredRead failed with Windows error ' + $errorCode)
    }
    try {
      $credential = [Runtime.InteropServices.Marshal]::PtrToStructure($pointer, [type][BlockwrightCredentialNative+CREDENTIAL])
      $blob = New-Object byte[] $credential.CredentialBlobSize
      [Runtime.InteropServices.Marshal]::Copy($credential.CredentialBlob, $blob, 0, $blob.Length)
      $secretText = [Text.Encoding]::Unicode.GetString($blob)
      $secretUtf8 = [Text.Encoding]::UTF8.GetBytes($secretText)
      Write-Result ([pscustomobject]@{ ok = $true; exists = $true; secretUtf8Base64 = [Convert]::ToBase64String($secretUtf8) })
      [Array]::Clear($secretUtf8, 0, $secretUtf8.Length)
      [Array]::Clear($blob, 0, $blob.Length)
      $secretText = $null
    } finally {
      if ($pointer -ne [IntPtr]::Zero) { [BlockwrightCredentialNative]::CredFree($pointer) }
    }
  }
  'status' {
    $pointer = [IntPtr]::Zero
    if ([BlockwrightCredentialNative]::CredRead($target, $type, 0, [ref]$pointer)) {
      if ($pointer -ne [IntPtr]::Zero) { [BlockwrightCredentialNative]::CredFree($pointer) }
      Write-Result ([pscustomobject]@{ ok = $true; exists = $true })
    } else {
      $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      if ($errorCode -ne $notFound) { throw ('CredRead failed with Windows error ' + $errorCode) }
      Write-Result ([pscustomobject]@{ ok = $true; exists = $false })
    }
  }
  'remove' {
    if ([BlockwrightCredentialNative]::CredDelete($target, $type, 0)) {
      Write-Result ([pscustomobject]@{ ok = $true; removed = $true })
    } else {
      $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      if ($errorCode -ne $notFound) { throw ('CredDelete failed with Windows error ' + $errorCode) }
      Write-Result ([pscustomobject]@{ ok = $true; removed = $false })
    }
  }
  'list' {
    $count = [uint32]0
    $pointer = [IntPtr]::Zero
    $targets = @()
    if ([BlockwrightCredentialNative]::CredEnumerate(([string]$request.prefix + '*'), 0, [ref]$count, [ref]$pointer)) {
      try {
        for ($index = 0; $index -lt $count; $index++) {
          $credentialPointer = [Runtime.InteropServices.Marshal]::ReadIntPtr($pointer, $index * [IntPtr]::Size)
          $credential = [Runtime.InteropServices.Marshal]::PtrToStructure($credentialPointer, [type][BlockwrightCredentialNative+CREDENTIAL])
          if ($credential.TargetName -like ([string]$request.prefix + '*')) { $targets += [string]$credential.TargetName }
        }
      } finally {
        if ($pointer -ne [IntPtr]::Zero) { [BlockwrightCredentialNative]::CredFree($pointer) }
      }
    } else {
      $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      if ($errorCode -ne $notFound) { throw ('CredEnumerate failed with Windows error ' + $errorCode) }
    }
    Write-Result ([pscustomobject]@{ ok = $true; targets = @($targets) })
  }
  default { throw 'Unsupported credential operation.' }
}
`;
function validateReference(reference) {
    if (!/^wincred:blockwright\/[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/.test(reference) || reference.includes("..") || reference.endsWith("/")) {
        throw new CredentialStoreError({
            code: "CREDENTIAL_REFERENCE_INVALID",
            message: "Credential references must use wincred:blockwright/<opaque-name> with no traversal segments.",
            likelyCause: "The caller supplied an unsupported credential identifier.",
            recommendedAction: "Generate a stable Blockwright credential reference and retry.",
        });
    }
    return reference;
}
function targetFor(reference) {
    return `${CREDENTIAL_TARGET_PREFIX}${reference.slice("wincred:blockwright/".length)}`;
}
function referenceFor(target) {
    if (!target.startsWith(CREDENTIAL_TARGET_PREFIX))
        return undefined;
    try {
        return validateReference(`wincred:blockwright/${target.slice(CREDENTIAL_TARGET_PREFIX.length)}`);
    }
    catch {
        return undefined;
    }
}
export class WindowsCredentialManagerStore {
    runner;
    timeoutMs;
    constructor(runner = new BoundedPowerShellRunner("win32"), timeoutMs = 10_000) {
        this.runner = runner;
        this.timeoutMs = timeoutMs;
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000)
            throw new Error("Credential operation timeout must be an integer from 100 through 60000 milliseconds.");
    }
    async operation(payload, signal) {
        const input = Buffer.from(JSON.stringify(payload), "utf8");
        try {
            const output = await this.runner.run(WINDOWS_CREDENTIAL_MANAGER_SCRIPT, { input, signal, timeoutMs: this.timeoutMs, maximumOutputBytes: 32 * 1024 });
            const result = JSON.parse(output);
            if (!result || typeof result !== "object" || result.ok !== true)
                throw new Error("Credential bridge returned an invalid response.");
            return result;
        }
        catch (error) {
            if (error instanceof CredentialStoreError)
                throw error;
            throw new CredentialStoreError({
                code: "CREDENTIAL_STORE_OPERATION_FAILED",
                message: `Windows Credential Manager could not complete the ${sanitizeDiagnosticText(payload.operation, 40)} operation.`,
                likelyCause: "The Windows credential service or bounded PowerShell bridge was unavailable.",
                recommendedAction: "Verify the current Windows user session and retry; collect sanitized diagnostics if the failure repeats.",
                retrySafe: true,
                retryReason: "The operation returned no accepted credential-store result.",
            });
        }
        finally {
            input.fill(0);
        }
    }
    async set(reference, secret, signal) {
        const validReference = validateReference(reference);
        if (!secret || secret.includes("\0"))
            throw new CredentialStoreError({
                code: "CREDENTIAL_VALUE_INVALID",
                message: "Credential values must be non-empty text without null characters.",
                likelyCause: "The supplied provider credential is empty or not representable by Windows Credential Manager.",
                recommendedAction: "Provide the original provider credential without surrounding formatting.",
            });
        const encodedLength = Buffer.byteLength(secret, "utf16le");
        if (encodedLength > 2560)
            throw new CredentialStoreError({
                code: "CREDENTIAL_VALUE_TOO_LARGE",
                message: "The credential exceeds the Windows Credential Manager generic-value boundary.",
                likelyCause: "The supplied secret is larger than 2560 UTF-16 bytes.",
                recommendedAction: "Use a shorter provider API credential.",
            });
        const secretBytes = Buffer.from(secret, "utf8");
        try {
            await this.operation({ operation: "set", target: targetFor(validReference), secretUtf8Base64: secretBytes.toString("base64") }, signal);
            return { reference: validReference, availability: "available", exists: true };
        }
        finally {
            secretBytes.fill(0);
        }
    }
    async read(reference, signal) {
        const validReference = validateReference(reference);
        const result = await this.operation({ operation: "read", target: targetFor(validReference) }, signal);
        if (!result.exists)
            return undefined;
        if (typeof result.secretUtf8Base64 !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(result.secretUtf8Base64))
            throw new CredentialStoreError({
                code: "CREDENTIAL_STORE_INVALID_RESPONSE",
                message: "Windows Credential Manager returned an invalid credential envelope.",
                likelyCause: "The local credential bridge and service are incompatible.",
                recommendedAction: "Repair or update Blockwright before reading the credential again.",
            });
        const bytes = Buffer.from(result.secretUtf8Base64, "base64");
        try {
            return bytes.toString("utf8");
        }
        finally {
            bytes.fill(0);
            result.secretUtf8Base64 = undefined;
        }
    }
    resolve(reference, signal) {
        return this.read(validateReference(reference), signal);
    }
    async status(reference, signal) {
        const validReference = validateReference(reference);
        const result = await this.operation({ operation: "status", target: targetFor(validReference) }, signal);
        return { reference: validReference, availability: result.exists ? "available" : "missing", exists: result.exists };
    }
    async testRead(reference, signal) {
        const result = await this.status(reference, signal);
        return { reference: result.reference, readable: result.exists, availability: result.availability };
    }
    async list(signal) {
        const result = await this.operation({ operation: "list", prefix: CREDENTIAL_TARGET_PREFIX }, signal);
        if (!Array.isArray(result.targets))
            throw new CredentialStoreError({
                code: "CREDENTIAL_STORE_INVALID_RESPONSE",
                message: "Windows Credential Manager returned an invalid reference list.",
                likelyCause: "The local credential bridge and service are incompatible.",
                recommendedAction: "Repair or update Blockwright before listing credentials again.",
            });
        return [...new Set(result.targets.flatMap((target) => typeof target === "string" ? [referenceFor(target)] : []).filter((reference) => Boolean(reference)))]
            .sort()
            .map((reference) => ({ reference }));
    }
    async remove(reference, signal) {
        const validReference = validateReference(reference);
        const result = await this.operation({ operation: "remove", target: targetFor(validReference) }, signal);
        return { reference: validReference, removed: result.removed === true };
    }
}
export class UnsupportedCredentialStore {
    unsupported() {
        throw new CredentialStoreError({
            code: "CREDENTIAL_STORE_UNSUPPORTED",
            message: "No operating-system credential adapter is available on this platform.",
            likelyCause: "The current platform is not Windows and no explicit credential adapter was supplied.",
            recommendedAction: "Continue without cloud credentials or install an explicitly supported operating-system credential adapter.",
        });
    }
    async set() { return this.unsupported(); }
    async read() { return this.unsupported(); }
    async resolve() { return this.unsupported(); }
    async testRead(reference) { return { reference, readable: false, availability: "unsupported" }; }
    async status(reference) { return { reference: validateReference(reference), availability: "unsupported", exists: false }; }
    async list() { return this.unsupported(); }
    async remove() { return this.unsupported(); }
}
export function createCredentialStore(options = {}) {
    if (options.adapter)
        return options.adapter;
    if ((options.platform ?? process.platform) !== "win32")
        return new UnsupportedCredentialStore();
    return new WindowsCredentialManagerStore(options.powerShellRunner ?? new BoundedPowerShellRunner("win32"), options.timeoutMs);
}
export function credentialErrorSummary(error) {
    return error instanceof CredentialStoreError
        ? { code: error.code, message: sanitizeDiagnosticText(error), retrySafe: error.retrySafe, recommendedAction: error.recommendedAction }
        : { code: "CREDENTIAL_STORE_FAILED", message: "The credential store operation failed.", retrySafe: false, recommendedAction: "Review sanitized diagnostics before retrying." };
}
//# sourceMappingURL=credential-store.js.map