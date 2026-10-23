param(
  [switch]$PreflightOnly,
  [switch]$Approved
)

$ErrorActionPreference = 'Stop'

$nodeCommand = Get-Command node -ErrorAction Stop
$runner = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'boxapi-one-shot.mjs'))

if ($PreflightOnly) {
  & $nodeCommand.Source "$runner" --preflight-only
  exit $LASTEXITCODE
}

if (-not $Approved) {
  [Console]::Error.WriteLine('Explicit -Approved switch is required for the single real-provider request. No request was sent.')
  exit 2
}

$secureKey = Read-Host 'Enter BoxAPI API key (input hidden; not saved)' -AsSecureString
if ($secureKey.Length -eq 0) {
  $secureKey.Dispose()
  [Console]::Error.WriteLine('No key entered. No request was sent.')
  exit 2
}

$bstr = [IntPtr]::Zero
$plainKey = $null
$processInfo = $null
$child = $null
try {
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
  $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)

  $processInfo = New-Object System.Diagnostics.ProcessStartInfo
  $processInfo.FileName = $nodeCommand.Source
  $processInfo.Arguments = '"' + $runner + '" --execute'
  $processInfo.UseShellExecute = $false
  $processInfo.CreateNoWindow = $false
  $processInfo.EnvironmentVariables['BOXAPI_API_KEY'] = $plainKey
  $processInfo.EnvironmentVariables['LIARA_LLM_ACCEPTANCE_APPROVED'] = 'YES'
  $processInfo.EnvironmentVariables['LIARA_LLM_OWNER_AUTHORIZED'] = 'YES'
  $processInfo.EnvironmentVariables['LIARA_DIAGNOSIS_PROVIDER'] = 'boxapi'

  $child = [System.Diagnostics.Process]::Start($processInfo)
  if ($null -eq $child) { throw 'Could not start the one-shot Node process.' }
  [void]$processInfo.EnvironmentVariables.Remove('BOXAPI_API_KEY')
  [void]$processInfo.EnvironmentVariables.Remove('LIARA_LLM_ACCEPTANCE_APPROVED')
  [void]$processInfo.EnvironmentVariables.Remove('LIARA_LLM_OWNER_AUTHORIZED')
  [void]$processInfo.EnvironmentVariables.Remove('LIARA_DIAGNOSIS_PROVIDER')
  $plainKey = $null
  $child.WaitForExit()
  exit $child.ExitCode
} finally {
  if ($null -ne $processInfo) {
    [void]$processInfo.EnvironmentVariables.Remove('BOXAPI_API_KEY')
    [void]$processInfo.EnvironmentVariables.Remove('LIARA_LLM_ACCEPTANCE_APPROVED')
    [void]$processInfo.EnvironmentVariables.Remove('LIARA_LLM_OWNER_AUTHORIZED')
    [void]$processInfo.EnvironmentVariables.Remove('LIARA_DIAGNOSIS_PROVIDER')
  }
  if ($null -ne $child) { $child.Dispose() }
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  if ($null -ne $secureKey) { $secureKey.Dispose() }
  $plainKey = $null
}
