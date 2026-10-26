param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Push-Location $projectRoot
try {
  $version = (Get-Content package.json -Raw | ConvertFrom-Json).version
  $config = Get-Content src-tauri/tauri.conf.json -Raw | ConvertFrom-Json
  $cargo = Get-Content src-tauri/Cargo.toml -Raw
  if ($config.version -ne $version -or $cargo -notmatch ('(?m)^version = "' + [regex]::Escape($version) + '"\r?$')) {
    throw 'Version numbers in package.json, Cargo.toml and tauri.conf.json must match'
  }
  $target = if ($env:NEWSMAP_TARGET) { $env:NEWSMAP_TARGET } else { 'x86_64-pc-windows-gnu' }
  if ($target -notin @('x86_64-pc-windows-gnu', 'x86_64-pc-windows-msvc')) { throw 'Unsupported Windows target' }
  if (-not $SkipBuild) {
    npm run build:installer
    if ($LASTEXITCODE -ne 0) { throw 'Installer build failed' }
  }
  $release = Join-Path $projectRoot "src-tauri/target/$target/release"
  $installer = Join-Path $release "bundle/nsis/NewsMapCN_${version}_x64-setup.exe"
  if (-not (Test-Path -LiteralPath $installer)) { throw "Installer is missing: $installer" }
  $output = Join-Path $projectRoot ".release/$version"
  New-Item -ItemType Directory -Path $output -Force | Out-Null
  $stage = Join-Path $projectRoot ('.release/stage-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $stage | Out-Null
  try {
    $portable = Join-Path $stage "NewsMapCN-portable-$version"
    New-Item -ItemType Directory -Path $portable | Out-Null
    Copy-Item -LiteralPath (Join-Path $release 'chinanews-screensaver.exe') -Destination (Join-Path $portable 'NewsMapCN.exe')
    $loader = Join-Path $release 'WebView2Loader.dll'
    if ($target.EndsWith('-gnu') -and -not (Test-Path -LiteralPath $loader)) { throw 'GNU build requires WebView2Loader.dll' }
    if (Test-Path -LiteralPath $loader) { Copy-Item -LiteralPath $loader -Destination $portable }
    Copy-Item -LiteralPath 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md' -Destination $portable
    Copy-Item -LiteralPath 'licenses' -Destination $portable -Recurse
    Copy-Item -LiteralPath $installer -Destination $output -Force
    Compress-Archive -LiteralPath $portable -DestinationPath (Join-Path $output "NewsMapCN-portable-$version.zip") -Force

    # Explicit source allowlist keeps local settings, caches and build directories out.
    $source = Join-Path $stage "NewsMapCN-source-$version"
    New-Item -ItemType Directory -Path $source | Out-Null
    $directories = @('.github', 'assets', 'docs', 'e2e', 'licenses', 'scripts', 'src', 'tests',
      'src-tauri/src', 'src-tauri/icons', 'src-tauri/capabilities')
    $files = @('.gitignore', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'SECURITY.md', 'CONTRIBUTING.md',
      'CHANGELOG.md', 'package.json', 'package-lock.json', 'index.html', 'tsconfig.json', 'vite.config.ts',
      'playwright.config.mjs', 'src-tauri/.gitignore', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock',
      'src-tauri/build.rs', 'src-tauri/common-controls.rc', 'src-tauri/common-controls.manifest',
      'src-tauri/nsis-hooks.nsh', 'src-tauri/tauri.conf.json')
    foreach ($entry in @($directories + $files)) {
      $destination = Join-Path $source $entry
      New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
      Copy-Item -LiteralPath $entry -Destination $destination -Recurse
    }
    Compress-Archive -LiteralPath $source -DestinationPath (Join-Path $output "NewsMapCN-source-$version.zip") -Force
    Copy-Item -LiteralPath "docs/releases/$version.md" -Destination (Join-Path $output 'RELEASE_NOTES.md') -Force
    $checksums = @(Get-ChildItem -LiteralPath $output -File | Where-Object Name -NE 'SHA256SUMS.txt' | Sort-Object Name |
      ForEach-Object {
        $stream = [IO.File]::OpenRead($_.FullName)
        $sha = [Security.Cryptography.SHA256]::Create()
        try {
          $hash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
          '{0}  {1}' -f $hash, $_.Name
        } finally { $stream.Dispose(); $sha.Dispose() }
      })
    $checksums | Set-Content -LiteralPath (Join-Path $output 'SHA256SUMS.txt') -Encoding ASCII
    Get-ChildItem -LiteralPath $output -File | Select-Object Name, Length
  } finally {
    $resolvedStage = [IO.Path]::GetFullPath($stage)
    $allowedRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot '.release')) + [IO.Path]::DirectorySeparatorChar
    if (-not $resolvedStage.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe staging path' }
    Remove-Item -LiteralPath $resolvedStage -Recurse -Force
  }
} finally {
  Pop-Location
}
