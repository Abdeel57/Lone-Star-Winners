param(
  [Parameter(Mandatory = $true)][string]$Docx,
  [Parameter(Mandatory = $true)][string]$OutJson
)

# Convierte un .docx en bloques: h (titulo), p (parrafo), list (lista) y table.
# Un parrafo cuyo texto entero va en negrita y es corto se trata como titulo:
# los documentos del abogado no usan estilos de titulo.

Add-Type -AssemblyName System.IO.Compression.FileSystem
$W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
$R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

$zip = [IO.Compression.ZipFile]::OpenRead($Docx)
function Read-Entry([string]$path) {
  $e = $zip.GetEntry($path)
  if ($null -eq $e) { return $null }
  $sr = New-Object IO.StreamReader($e.Open())
  $t = $sr.ReadToEnd(); $sr.Close(); return $t
}

[xml]$doc = Read-Entry "word/document.xml"
$relsText = Read-Entry "word/_rels/document.xml.rels"
$numText = Read-Entry "word/numbering.xml"
$zip.Dispose()

$ns = New-Object Xml.XmlNamespaceManager($doc.NameTable)
$ns.AddNamespace("w", $W); $ns.AddNamespace("r", $R)

$rels = @{}
if ($relsText) {
  [xml]$relsXml = $relsText
  foreach ($rel in $relsXml.Relationships.Relationship) { $rels[$rel.Id] = $rel.Target }
}

# numId -> abstractNumId -> formato del nivel 0 (bullet u ordenada)
$numFormat = @{}
if ($numText) {
  [xml]$numXml = $numText
  $nns = New-Object Xml.XmlNamespaceManager($numXml.NameTable); $nns.AddNamespace("w", $W)
  $abstract = @{}
  foreach ($a in $numXml.SelectNodes("//w:abstractNum", $nns)) {
    $id = $a.GetAttribute("abstractNumId", $W)
    $lvls = @{}
    foreach ($l in $a.SelectNodes("w:lvl", $nns)) {
      $fmt = $l.SelectSingleNode("w:numFmt", $nns)
      $lvls[$l.GetAttribute("ilvl", $W)] = if ($fmt) { $fmt.GetAttribute("val", $W) } else { "bullet" }
    }
    $abstract[$id] = $lvls
  }
  foreach ($n in $numXml.SelectNodes("//w:num", $nns)) {
    $aid = $n.SelectSingleNode("w:abstractNumId", $nns).GetAttribute("val", $W)
    $numFormat[$n.GetAttribute("numId", $W)] = $abstract[$aid]
  }
}

function Get-Runs($para) {
  $runs = New-Object System.Collections.ArrayList
  foreach ($node in $para.SelectNodes("w:r | w:hyperlink | w:ins/w:r | w:smartTag/w:r", $ns)) {
    $href = $null
    $runNodes = @($node)
    if ($node.LocalName -eq "hyperlink") {
      $rid = $node.GetAttribute("id", $R)
      if ($rid -and $rels.ContainsKey($rid)) { $href = $rels[$rid] }
      $anchor = $node.GetAttribute("anchor", $W)
      if (-not $href -and $anchor) { $href = "#" + $anchor }
      $runNodes = @($node.SelectNodes("w:r", $ns))
    }
    foreach ($r in $runNodes) {
      $text = ""
      foreach ($c in $r.ChildNodes) {
        switch ($c.LocalName) {
          "t" { $text += $c.InnerText }
          "tab" { $text += " " }
          "br" { $text += "`n" }
          "noBreakHyphen" { $text += "-" }
        }
      }
      if ($text.Length -eq 0) { continue }
      $bold = $null -ne $r.SelectSingleNode("w:rPr/w:b[not(@w:val='0') and not(@w:val='false')]", $ns)
      $italic = $null -ne $r.SelectSingleNode("w:rPr/w:i[not(@w:val='0') and not(@w:val='false')]", $ns)
      $underline = $null -ne $r.SelectSingleNode("w:rPr/w:u[not(@w:val='none')]", $ns)
      $last = if ($runs.Count -gt 0) { $runs[$runs.Count - 1] } else { $null }
      if ($last -and $last.b -eq $bold -and $last.i -eq $italic -and $last.u -eq $underline -and $last.href -eq $href) {
        $last.x += $text
      } else {
        [void]$runs.Add([ordered]@{ x = $text; b = $bold; i = $italic; u = $underline; href = $href })
      }
    }
  }
  return ,$runs
}

function Compact-Runs($runs) {
  $out = @()
  foreach ($r in $runs) {
    $o = [ordered]@{ x = $r.x }
    if ($r.b) { $o.b = $true }
    if ($r.i) { $o.i = $true }
    if ($r.href) { $o.href = $r.href }
    $out += $o
  }
  return ,$out
}

$blocks = New-Object System.Collections.ArrayList
$currentList = $null

function Close-List { if ($script:currentList) { [void]$script:blocks.Add($script:currentList); $script:currentList = $null } }

$body = $doc.SelectSingleNode("//w:body", $ns)
foreach ($child in $body.ChildNodes) {
  if ($child.LocalName -eq "p") {
    $runs = Get-Runs $child
    $text = (($runs | ForEach-Object { $_.x }) -join "").Trim()
    if ($text.Length -eq 0) { continue }

    $numPr = $child.SelectSingleNode("w:pPr/w:numPr", $ns)
    if ($numPr) {
      $numId = $numPr.SelectSingleNode("w:numId", $ns).GetAttribute("val", $W)
      $ilvlNode = $numPr.SelectSingleNode("w:ilvl", $ns)
      $ilvl = if ($ilvlNode) { $ilvlNode.GetAttribute("val", $W) } else { "0" }
      $fmt = if ($numFormat.ContainsKey($numId) -and $numFormat[$numId].ContainsKey($ilvl)) { $numFormat[$numId][$ilvl] } else { "bullet" }
      $ordered = $fmt -ne "bullet" -and $fmt -ne "none"
      if (-not $currentList -or $currentList.numId -ne $numId) {
        Close-List
        $script:currentList = [ordered]@{ t = "list"; ordered = $ordered; numId = $numId; items = @() }
      }
      $script:currentList.items += , (Compact-Runs $runs)
      continue
    }

    # Vinetas escritas a mano (U+2022 y parecidas): lista sin numerar. Los
    # caracteres van como escapes: PowerShell 5.1 lee este archivo como ANSI.
    $bulletClass = "[" + [char]0x2022 + [char]0x25E6 + [char]0x25AA + [char]0x00B7 + "]"
    if ($text -match ("^" + $bulletClass + "\s*")) {
      $first = $runs[0]
      $first.x = ($first.x -replace ("^\s*" + $bulletClass + "\s*"), "")
      if (-not $currentList -or $currentList.numId -ne "manual") {
        Close-List
        $script:currentList = [ordered]@{ t = "list"; ordered = $false; numId = "manual"; items = @() }
      }
      $script:currentList.items += , (Compact-Runs $runs)
      continue
    }

    Close-List
    $nonEmpty = @($runs | Where-Object { $_.x.Trim().Length -gt 0 })
    $allBold = $nonEmpty.Count -gt 0 -and @($nonEmpty | Where-Object { -not $_.b }).Count -eq 0
    # Un parrafo entero en negrita con una frase completa dentro ("Derecho a
    # borrar. Tienes derecho a...") es texto destacado, no un titulo.
    $isSentence = $text -match '\.\s+\S'
    if ($allBold -and $text.Length -le 160 -and -not $isSentence) {
      [void]$blocks.Add([ordered]@{ t = "h"; text = $text })
    } else {
      [void]$blocks.Add([ordered]@{ t = "p"; runs = (Compact-Runs $runs) })
    }
  } elseif ($child.LocalName -eq "tbl") {
    Close-List
    $rows = @()
    foreach ($tr in $child.SelectNodes("w:tr", $ns)) {
      $cells = @()
      foreach ($tc in $tr.SelectNodes("w:tc", $ns)) {
        $paras = @()
        foreach ($p in $tc.SelectNodes("w:p", $ns)) {
          $runs = Get-Runs $p
          $t = (($runs | ForEach-Object { $_.x }) -join "").Trim()
          if ($t.Length -gt 0) { $paras += , (Compact-Runs $runs) }
        }
        $cells += , $paras
      }
      $rows += , $cells
    }
    [void]$blocks.Add([ordered]@{ t = "table"; rows = $rows })
  }
}
Close-List

foreach ($b in $blocks) { if ($b.Contains("numId")) { $b.Remove("numId") } }

$json = $blocks | ConvertTo-Json -Depth 20 -Compress
[IO.File]::WriteAllText($OutJson, $json, (New-Object System.Text.UTF8Encoding $false))
"bloques: $($blocks.Count)"
