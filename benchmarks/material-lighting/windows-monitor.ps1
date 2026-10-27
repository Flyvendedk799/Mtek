$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
[Diagnostics.Process]::GetCurrentProcess().PriorityClass = [Diagnostics.ProcessPriorityClass]::BelowNormal
$taskIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$taskPrincipal = [Security.Principal.WindowsPrincipal]::new($taskIdentity)
@{
    event = 'ready'
    frequency = [Diagnostics.Stopwatch]::Frequency
    qpc = [Diagnostics.Stopwatch]::GetTimestamp()
    administrator = $taskPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    performanceLogUsers = $taskIdentity.Groups.Value -contains 'S-1-5-32-559'
} | ConvertTo-Json -Compress
while ($null -ne ($line = [Console]::ReadLine())) {
    try {
        $request = $line | ConvertFrom-Json
        if ($request.kind -eq 'stop') { break }
        $result = @{ id = $request.id; kind = $request.kind; qpc = [Diagnostics.Stopwatch]::GetTimestamp() }
        switch ($request.kind) {
            'clock' { }
            'gpu' {
                $rows = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine)
                if ($rows.Count -eq 0) { throw 'No GPU engine performance counters are available' }
                $result.counterRows = $rows.Count
                $result.nonzero = @($rows | Where-Object UtilizationPercentage -gt 0 | ForEach-Object {
                    @{ name = $_.Name; percent = $_.UtilizationPercentage }
                })
                $result.qpcEnd = [Diagnostics.Stopwatch]::GetTimestamp()
            }
            'signature' {
                $signature = Get-AuthenticodeSignature -LiteralPath $request.path
                $result.status = [string]$signature.Status
                $result.subject = $signature.SignerCertificate.Subject
            }
            default { throw "Unknown monitor request: $($request.kind)" }
        }
        $result | ConvertTo-Json -Depth 5 -Compress
    } catch {
        @{ id = $request.id; error = $_.Exception.Message } | ConvertTo-Json -Compress
    }
}
