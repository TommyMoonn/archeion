#requires -Version 7.0

function ConvertTo-CliBoolean {
    param(
        [Parameter(Mandatory)]
        [object]$Value,

        [Parameter(Mandatory)]
        [string]$OptionName
    )

    if ($Value -is [bool]) {
        return $Value
    }

    $text = ([string]$Value).Trim()
    switch ($text.ToLowerInvariant()) {
        'true' { return $true }
        '$true' { return $true }
        '1' { return $true }
        'yes' { return $true }
        'false' { return $false }
        '$false' { return $false }
        '0' { return $false }
        'no' { return $false }
        default { throw "Option '$OptionName' expects a boolean value." }
    }
}

function Add-CliMultiValue {
    param(
        [Parameter(Mandatory)]
        [System.Collections.Generic.List[object]]$Target,

        [Parameter(Mandatory)]
        [object]$Value
    )

    if ($Value -is [string]) {
        foreach ($item in ([string]$Value -split ',')) {
            $trimmed = $item.Trim()
            if (-not [string]::IsNullOrWhiteSpace($trimmed)) {
                $Target.Add($trimmed)
            }
        }
        return
    }

    if ($Value -isnot [System.Collections.IEnumerable]) {
        $Target.Add($Value)
        return
    }

    foreach ($item in $Value) {
        Add-CliMultiValue -Target $Target -Value $item
    }
}

function ConvertFrom-CliArguments {
    param(
        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [object[]]$Arguments,

        [Parameter(Mandatory)]
        [hashtable]$OptionSpecs,

        [string[]]$Positionals = @()
    )

    $result = [ordered]@{ help = $false }
    $aliases = @{}
    $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

    foreach ($name in $OptionSpecs.Keys) {
        $spec = $OptionSpecs[$name]
        $kind = if ($spec.ContainsKey('Kind')) { [string]$spec['Kind'] } else { 'Value' }

        if ($spec.ContainsKey('Default')) {
            $result[$name] = $spec['Default']
        }
        elseif ($kind -eq 'Switch') {
            $result[$name] = $false
        }
        elseif ($kind -eq 'MultiValue') {
            $result[$name] = @()
        }
        else {
            $result[$name] = $null
        }

        $optionAliases = @()
        if (-not $spec.ContainsKey('Canonical') -or [bool]$spec['Canonical']) {
            $optionAliases += "--$name"
        }

        if ($spec.ContainsKey('Aliases')) {
            $optionAliases += @($spec['Aliases'])
        }

        foreach ($alias in $optionAliases) {
            if ([string]::IsNullOrWhiteSpace([string]$alias)) {
                continue
            }

            $normalizedAlias = ([string]$alias).ToLowerInvariant()
            if ($aliases.ContainsKey($normalizedAlias)) {
                throw "CLI alias '$alias' is configured more than once."
            }

            $aliases[$normalizedAlias] = $name
        }
    }

    $positionIndex = 0
    $parseOptions = $true

    for ($index = 0; $index -lt $Arguments.Count; $index++) {
        $argumentObject = $Arguments[$index]
        $token = [string]$argumentObject

        if ($parseOptions -and $token -eq '--') {
            $parseOptions = $false
            continue
        }

        if ($parseOptions -and @('--help', '-h', '-Help', '-?') -contains $token) {
            $result['help'] = $true
            continue
        }

        $optionToken = $token
        $attachedValue = $null
        $hasAttachedValue = $false

        if ($parseOptions -and $token.StartsWith('-')) {
            $separatorIndex = $token.IndexOf('=')
            if ($separatorIndex -gt 0) {
                $optionToken = $token.Substring(0, $separatorIndex)
                $attachedValue = $token.Substring($separatorIndex + 1)
                $hasAttachedValue = $true
            }
            elseif (-not $token.StartsWith('--')) {
                $separatorIndex = $token.IndexOf(':')
                if ($separatorIndex -gt 0) {
                    $optionToken = $token.Substring(0, $separatorIndex)
                    $attachedValue = $token.Substring($separatorIndex + 1)
                    $hasAttachedValue = $true
                }
            }

            $normalizedOption = $optionToken.ToLowerInvariant()
            if (-not $aliases.ContainsKey($normalizedOption)) {
                throw "Unknown option '$optionToken'. Run with --help to see supported options."
            }

            $name = [string]$aliases[$normalizedOption]
            $spec = $OptionSpecs[$name]
            $kind = if ($spec.ContainsKey('Kind')) { [string]$spec['Kind'] } else { 'Value' }

            if ($kind -eq 'Switch') {
                $value = if ($hasAttachedValue) {
                    ConvertTo-CliBoolean -Value $attachedValue -OptionName $optionToken
                }
                else {
                    $true
                }

                $result[$name] = $value
                [void]$seen.Add($name)
                continue
            }

            if (-not $hasAttachedValue) {
                if (($index + 1) -ge $Arguments.Count) {
                    throw "Option '$optionToken' requires a value."
                }

                $index++
                $attachedValue = $Arguments[$index]
            }

            if ($kind -eq 'MultiValue') {
                $items = [System.Collections.Generic.List[object]]::new()
                if ($seen.Contains($name) -and $result[$name]) {
                    foreach ($existing in @($result[$name])) {
                        $items.Add($existing)
                    }
                }

                Add-CliMultiValue -Target $items -Value $attachedValue
                $result[$name] = @($items)
                [void]$seen.Add($name)
                continue
            }

            if ($seen.Contains($name)) {
                throw "Option '$optionToken' was provided more than once."
            }

            $result[$name] = $attachedValue
            [void]$seen.Add($name)
            continue
        }

        if ($positionIndex -ge $Positionals.Count) {
            throw "Unexpected positional argument '$token'. Run with --help to see usage."
        }

        $name = $Positionals[$positionIndex]
        $positionIndex++

        if ($seen.Contains($name)) {
            throw "Argument '$name' was provided both positionally and by option."
        }

        $result[$name] = $argumentObject
        [void]$seen.Add($name)
    }

    return ,$result
}

function ConvertTo-CliInt {
    param(
        [Parameter(Mandatory)]
        [object]$Value,

        [Parameter(Mandatory)]
        [string]$OptionName,

        [int]$Minimum = [int]::MinValue,
        [int]$Maximum = [int]::MaxValue
    )

    $parsed = 0
    if (-not [int]::TryParse([string]$Value, [ref]$parsed)) {
        throw "Option '$OptionName' expects an integer."
    }

    if ($parsed -lt $Minimum -or $parsed -gt $Maximum) {
        throw "Option '$OptionName' must be between $Minimum and $Maximum."
    }

    return $parsed
}

function Resolve-CliChoice {
    param(
        [Parameter(Mandatory)]
        [object]$Value,

        [Parameter(Mandatory)]
        [string]$OptionName,

        [Parameter(Mandatory)]
        [string[]]$AllowedValues
    )

    $text = [string]$Value
    foreach ($allowed in $AllowedValues) {
        if ($text.Equals($allowed, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $allowed
        }
    }

    throw "Option '$OptionName' must be one of: $($AllowedValues -join ', ')."
}

function Write-CliHelp {
    param(
        [Parameter(Mandatory)]
        [string]$Text
    )

    Write-Host $Text.Trim()
}
