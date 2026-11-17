$files = @('install.ps1', 'uninstall.ps1', 'package.ps1')
foreach ($f in $files) {
    $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $f), [ref]$null, [ref]$errors)
    if ($errors.Count -eq 0) {
        Write-Host ("OK   " + $f)
    } else {
        Write-Host ("FAIL " + $f + " : " + $errors[0].Message)
    }
}
