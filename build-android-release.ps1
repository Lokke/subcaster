# SubCaster Android - Release Build
Write-Host "🏗️  Building SubCaster Android Release APK..." -ForegroundColor Green
Write-Host "⚠️  Note: This will create an UNSIGNED APK" -ForegroundColor Yellow
Write-Host "    For Play Store, you need to sign it with a keystore`n" -ForegroundColor Yellow

# Build Web App
Write-Host "📦 Step 1: Building Web App..." -ForegroundColor Cyan
npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Web build failed!" -ForegroundColor Red
    exit 1
}

# Sync with Capacitor
Write-Host "`n🔄 Step 2: Syncing with Capacitor..." -ForegroundColor Cyan
npx cap sync android

# Build Release APK
Write-Host "`n🤖 Step 3: Building Android Release APK..." -ForegroundColor Cyan
Set-Location android
.\gradlew assembleRelease
Set-Location ..

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Android build failed!" -ForegroundColor Red
    exit 1
}

# Copy APK to root
Write-Host "`n📋 Step 4: Copying APK..." -ForegroundColor Cyan
Copy-Item "android\app\build\outputs\apk\release\app-release-unsigned.apk" -Destination "SubCaster-Release-Unsigned.apk" -Force

# Get file info
$apk = Get-Item "SubCaster-Release-Unsigned.apk"
$sizeMB = [math]::Round($apk.Length / 1MB, 2)

Write-Host "`n✅ Build successful!" -ForegroundColor Green
Write-Host "📱 APK: SubCaster-Release-Unsigned.apk" -ForegroundColor Yellow
Write-Host "📊 Size: $sizeMB MB" -ForegroundColor Yellow
Write-Host "📅 Built: $($apk.LastWriteTime)" -ForegroundColor Yellow
Write-Host "`n⚠️  This APK is UNSIGNED and needs signing before distribution!" -ForegroundColor Yellow
Write-Host "   See ANDROID_BUILD.md for signing instructions" -ForegroundColor Cyan
