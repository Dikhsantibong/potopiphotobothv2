Get-ChildItem -Directory | ForEach-Object { 
  $size = 0
  Get-ChildItem $_.FullName -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object { $size += $_.Length }
  [PSCustomObject]@{
    Name = $_.Name
    SizeMB = [math]::Round($size / 1MB, 2)
  } 
} | Sort-Object SizeMB -Descending | Format-Table -AutoSize
