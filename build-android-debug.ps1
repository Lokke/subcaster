# SubCaster Android - Debug Build
Write-Host "🏗️  Building SubCaster Android Debug APK..." -ForegroundColor Green

# Build Web App
Write-Host "`n📦 Step 1: Building Web App..." -ForegroundColor Cyan
npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Web build failed!" -ForegroundColor Red
    exit 1
}

# Sync with Capacitor
Write-Host "`n🔄 Step 2: Syncing with Capacitor..." -ForegroundColor Cyan
npx cap sync android

# Build APK
Write-Host "`n🤖 Step 3: Building Android APK..." -ForegroundColor Cyan
Set-Location android
.\gradlew assembleDebug
Set-Location ..

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Android build failed!" -ForegroundColor Red
    exit 1
}

# Copy APK to root
Write-Host "`n📋 Step 4: Copying APK..." -ForegroundColor Cyan
Copy-Item "android\app\build\outputs\apk\debug\app-debug.apk" -Destination "SubCaster-Debug.apk" -Force

# Get file info
$apk = Get-Item "SubCaster-Debug.apk"
$sizeMB = [math]::Round($apk.Length / 1MB, 2)

Write-Host "`n✅ Build successful!" -ForegroundColor Green
Write-Host "📱 APK: SubCaster-Debug.apk" -ForegroundColor Yellow
Write-Host "📊 Size: $sizeMB MB" -ForegroundColor Yellow
Write-Host "📅 Built: $($apk.LastWriteTime)" -ForegroundColor Yellow
Write-Host "`n🚀 Ready to install on Android device!" -ForegroundColor Green
