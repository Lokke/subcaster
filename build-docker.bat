@echo off
echo Building SubCaster Docker image...
docker build -t SubCaster:latest .

if %ERRORLEVEL% EQU 0 (
    echo Build successful!
    echo.
    echo To run the container:
    echo docker run -d --name SubCaster -p 5173:5173 SubCaster:latest
    echo.
    echo Or use Docker Compose:
    echo docker-compose up -d
    echo.
    echo Access the SubCaster interface at: http://localhost:5173
) else (
    echo Build failed!
    exit /b 1
)
