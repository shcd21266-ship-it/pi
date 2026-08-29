$iconPath = Join-Path $PSScriptRoot "public\icons"
if (!(Test-Path $iconPath)) { New-Item -ItemType Directory -Force -Path $iconPath | Out-Null }

Add-Type -AssemblyName System.Drawing
$sizes = @(16, 48, 128)
foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $graphics = [System.Drawing.Graphics]::FromImage($bmp)
    
    # Create a nice gradient or solid color
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 96, 165, 250)) # Tailwind blue-400
    $graphics.FillRectangle($brush, 0, 0, $size, $size)
    
    # Draw simple text "Q"
    if ($size -ge 48) {
        $font = New-Object System.Drawing.Font("Arial", ($size/2), [System.Drawing.FontStyle]::Bold)
        $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
        $format = New-Object System.Drawing.StringFormat
        $format.Alignment = [System.Drawing.StringAlignment]::Center
        $format.LineAlignment = [System.Drawing.StringAlignment]::Center
        $rect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
        $graphics.DrawString("Q", $font, $textBrush, $rect, $format)
        $font.Dispose()
        $textBrush.Dispose()
    }
    
    $path = Join-Path $iconPath "icon$size.png"
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    
    $graphics.Dispose()
    $bmp.Dispose()
    $brush.Dispose()
    Write-Host "Created $path"
}

Write-Host "All icons generated successfully!"
