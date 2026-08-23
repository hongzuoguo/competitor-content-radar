import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const guide = JSON.parse(readFileSync('docs/user-guide-content.json', 'utf8'))
const allText = JSON.stringify(guide)
const python = process.env.PYTHON ?? 'python'
const script = join(process.cwd(), 'scripts', 'build-user-guide.py')
const release = mkdtempSync(join(tmpdir(), 'user-guide-output-'))
const outputPaths = {
  markdown: join(release, `${guide.output_stem}.md`),
  docx: join(release, `${guide.output_stem}.docx`)
}

afterAll(() => {
  rmSync(release, { recursive: true, force: true })
})

function runPython(args: string[]) {
  return spawnSync(python, args, { cwd: process.cwd(), encoding: 'utf8' })
}

function runGuideBuilder() {
  return runPython([script, '--output-directory', release])
}

function validateGuide(value: unknown) {
  const directory = mkdtempSync(join(tmpdir(), 'user-guide-validation-'))
  const source = join(directory, 'guide.json')
  writeFileSync(source, JSON.stringify(value), 'utf8')
  const harness = [
    'import importlib.util, json, pathlib, sys',
    'spec = importlib.util.spec_from_file_location("guide_builder", sys.argv[1])',
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    'module.validate_guide(json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8")))'
  ].join('; ')
  const result = runPython(['-c', harness, script, source])
  rmSync(directory, { recursive: true, force: true })
  return result
}

describe('public user guide', () => {
  it('uses the HitMuse product name throughout the guide', () => {
    expect(guide.title).toBe('HitMuse 使用说明')
    expect(allText).not.toContain('对标内容雷达')
  })

  it.each([
    '安装包内置内容',
    '首次配置',
    '主要功能',
    '推荐使用流程',
    '数据和隐私',
    '已知限制',
    '常见问题',
    '自动更新',
    'MIT License'
  ])('contains %s', (heading) => {
    expect(allText).toContain(heading)
  })

  it('uses MIT-consistent wording', () => {
    expect(allText).not.toContain('\u7981\u6b62\u5546\u7528')
  })

  it('explains the public installer, manual first upgrade, and safe source distinction', () => {
    expect(allText).toContain('Windows 10 或 Windows 11')
    expect(allText).toContain('Chrome 或 Edge')
    expect(allText).toContain('同一公开 GitHub 仓库的 Releases')
    expect(allText).toContain('SHA-256')
    expect(allText).toContain('SmartScreen')
    expect(allText).toContain('第一次从旧版升级')
    expect(allText).toContain('com.hitmuse.desktop')
    expect(allText).toContain('userData')
    expect(allText).toContain('源码用于开发')
    expect(allText).toContain('飞书同步是可选功能')
    expect(allText).toContain('自己的飞书自建应用、产品 Base 模板副本以及对该 Base 的编辑权限')
    expect(allText).not.toContain('当前版本暂不提供飞书同步')
  })
})

describe('release guide preparation', () => {
  it('builds and publishes only Markdown and DOCX guides with a pinned document dependency', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8')

    expect(workflow).toContain('scripts/build-user-guide.py')
    expect(workflow).toContain('python-docx==1.2.0')
    expect(workflow).toContain('release/guides/competitor-content-radar-user-guide.md')
    expect(workflow).toContain('release/guides/competitor-content-radar-user-guide.docx')
    expect(workflow).not.toContain('release/guides/competitor-content-radar-user-guide.html')
  })
})

describe('one-source guide renderer', () => {
  it('writes deterministic DOCX archive timestamps for repeatable release review', () => {
    const result = runGuideBuilder()
    expect(result.status, result.stderr).toBe(0)

    const inspection = runPython(['-c', [
      'import json, sys, zipfile',
      'with zipfile.ZipFile(sys.argv[1]) as archive:',
      '  timestamps = sorted({entry.date_time for entry in archive.infolist()})',
      'print(json.dumps(timestamps))'
    ].join('\n'), outputPaths.docx])
    expect(inspection.status, inspection.stderr).toBe(0)
    expect(JSON.parse(inspection.stdout)).toEqual([[1980, 1, 1, 0, 0, 0]])
  })

  it('keeps all user-visible presentation copy and output naming in the canonical JSON source', () => {
    expect(guide.presentation).toEqual(expect.objectContaining({
      cover_kicker: expect.any(String),
      cover_notice: expect.any(String),
      cover_audience: expect.any(String),
      docx_header: expect.any(String),
      docx_footer_prefix: expect.any(String),
      docx_footer_suffix: expect.any(String)
    }))
    expect(guide.presentation).not.toHaveProperty('html_footer')
    expect(guide.output_stem).toBe('competitor-content-radar-user-guide')
  })

  it('uses real ordered lists in Markdown and DOCX, with all JSON body copy preserved in order', () => {
    const result = runGuideBuilder()
    expect(result.status, result.stderr).toBe(0)
    for (const outputPath of Object.values(outputPaths)) {
      expect(result.stdout).toContain(outputPath)
    }
    expect(result.stdout).not.toContain('.html')
    expect(Object.values(outputPaths).every(existsSync)).toBe(true)
    expect(existsSync(join(process.cwd(), 'release'))).toBe(false)

    const sectionTitles = guide.sections.map((section: { title: string }) => section.title)
    const orderedSection = guide.sections.find((section: { title: string }) => section.title === '推荐使用流程')
    expect(orderedSection.ordered_items).toEqual(expect.any(Array))
    expect(orderedSection.items).toBeUndefined()

    const markdown = readFileSync(outputPaths.markdown, 'utf8')
    expect(markdown.split(/\r?\n/).filter((line) => line.startsWith('## ')).map((line) => line.slice(3))).toEqual(sectionTitles)
    for (const item of orderedSection.ordered_items) {
      expect(markdown).toContain(`1. ${item}`)
      expect(markdown).not.toContain(`- ${item}`)
    }

    const inspection = runPython(['-c', [
      'import json, sys, zipfile',
      'from docx import Document',
      'from xml.etree import ElementTree as ET',
      "ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}",
      "w = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'",
      'doc = Document(sys.argv[1])',
      "headings = [p.text for p in doc.paragraphs if p.style.name == 'Heading 1']",
      'with zipfile.ZipFile(sys.argv[1]) as archive:',
      "  document_xml = ET.fromstring(archive.read('word/document.xml'))",
      "  styles_xml = ET.fromstring(archive.read('word/styles.xml'))",
      "  numbering_xml = ET.fromstring(archive.read('word/numbering.xml'))",
      "section = document_xml.find('.//w:sectPr', ns)",
      "margins = section.find('w:pgMar', ns)",
      "page_size = section.find('w:pgSz', ns)",
      "normal_style = next(style for style in styles_xml.findall('w:style', ns) if style.attrib.get(w + 'styleId') == 'Normal')",
      "normal_fonts = normal_style.find('.//w:rFonts', ns)",
      "list_bullet = next(style for style in styles_xml.findall('w:style', ns) if style.find('w:name', ns) is not None and style.find('w:name', ns).attrib.get(w + 'val') == 'List Bullet')",
      "numbering = {num.attrib[w + 'numId']: num.find('w:abstractNumId', ns).attrib[w + 'val'] for num in numbering_xml.findall('w:num', ns)}",
      "formats = {abstract.attrib[w + 'abstractNumId']: abstract.find('.//w:numFmt', ns).attrib[w + 'val'] for abstract in numbering_xml.findall('w:abstractNum', ns) if abstract.find('.//w:numFmt', ns) is not None}",
      "num_ids = [node.find('w:numId', ns).attrib[w + 'val'] for node in document_xml.findall('.//w:numPr', ns) if node.find('w:numId', ns) is not None]",
      "resolved_formats = [formats[numbering[num_id]] for num_id in num_ids if num_id in numbering and numbering[num_id] in formats]",
      "print(json.dumps({'headings': headings, 'footer': doc.sections[0].footer.paragraphs[0].text, 'body': [p.text for p in doc.paragraphs], 'east_asia': normal_fonts.attrib.get(w + 'eastAsia'), 'has_list_bullet_style': list_bullet is not None, 'has_real_bullets': 'bullet' in resolved_formats, 'has_real_decimal': 'decimal' in resolved_formats, 'page_width': page_size.attrib.get(w + 'w'), 'page_height': page_size.attrib.get(w + 'h'), 'margins': {side: margins.attrib.get(w + side) for side in ('top', 'right', 'bottom', 'left')}}, ensure_ascii=False))"
    ].join('\n'), outputPaths.docx])
    expect(inspection.status, inspection.stderr).toBe(0)
    const document = JSON.parse(inspection.stdout)
    expect(document.headings).toEqual(sectionTitles)
    expect(document.footer).toContain(guide.presentation.docx_footer_prefix.trim())
    expect(document.has_list_bullet_style).toBe(true)
    expect(document.has_real_bullets).toBe(true)
    expect(document.has_real_decimal).toBe(true)
    expect(document.east_asia).toBe('Microsoft YaHei')
    expect(document.page_width).toBe('12240')
    expect(document.page_height).toBe('15840')
    expect(document.margins).toEqual({ top: '1440', right: '1440', bottom: '1440', left: '1440' })

    const body = guide.sections.flatMap((section: { paragraphs?: string[]; items?: string[]; ordered_items?: string[] }) => [
      ...(section.paragraphs ?? []),
      ...(section.items ?? []),
      ...(section.ordered_items ?? [])
    ])
    let markdownOffset = 0
    let documentOffset = 0
    for (const text of body) {
      markdownOffset = markdown.indexOf(text, markdownOffset)
      documentOffset = document.body.indexOf(text, documentOffset)
      expect(markdownOffset, `Markdown is missing or reorders: ${text}`).toBeGreaterThanOrEqual(0)
      expect(documentOffset, `DOCX is missing or reorders: ${text}`).toBeGreaterThanOrEqual(0)
      markdownOffset += text.length
      documentOffset += 1
    }
  })

  it('restarts each independent ordered guide section at 1 in DOCX', () => {
    const result = runGuideBuilder()
    expect(result.status, result.stderr).toBe(0)
    const orderedSections = guide.sections.filter((section: { ordered_items?: string[] }) => section.ordered_items)
    expect(orderedSections.length).toBeGreaterThan(1)

    const inspection = runPython(['-c', [
      'import json, sys, zipfile',
      'from xml.etree import ElementTree as ET',
      "ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}",
      "w = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'",
      'targets = json.loads(sys.argv[2])',
      'with zipfile.ZipFile(sys.argv[1]) as archive:',
      "  document = ET.fromstring(archive.read('word/document.xml'))",
      'paragraphs = []',
      "for paragraph in document.findall('.//w:body/w:p', ns):",
      "  text = ''.join(node.text or '' for node in paragraph.findall('.//w:t', ns))",
      "  num_id_node = paragraph.find('./w:pPr/w:numPr/w:numId', ns)",
      "  paragraphs.append((text, num_id_node.attrib.get(w + 'val') if num_id_node is not None else None))",
      'first_ids = []',
      'for target in targets:',
      '  first_ids.append(next(num_id for text, num_id in paragraphs if text == target))',
      "with zipfile.ZipFile(sys.argv[1]) as archive:",
      "  numbering = ET.fromstring(archive.read('word/numbering.xml'))",
      "restart_values = {}",
      "for number in numbering.findall('./w:num', ns):",
      "  num_id = number.attrib.get(w + 'numId')",
      "  start = number.find('./w:lvlOverride/w:startOverride', ns)",
      "  restart_values[num_id] = start.attrib.get(w + 'val') if start is not None else None",
      "print(json.dumps({'first_ids': first_ids, 'restart_values': restart_values}))"
    ].join('\n'), outputPaths.docx, JSON.stringify(orderedSections.map((section: { ordered_items: string[] }) => section.ordered_items[0]))])
    expect(inspection.status, inspection.stderr).toBe(0)
    const { first_ids: firstNumberingIds, restart_values: restartValues } = JSON.parse(inspection.stdout)
    expect(new Set(firstNumberingIds).size).toBe(orderedSections.length)
    expect(firstNumberingIds.map((id: string) => restartValues[id])).toEqual(
      orderedSections.map(() => '1')
    )
  })

  it('rejects malformed guide content and unsafe output stems before writing files', () => {
    const cases: [string, unknown][] = [
      ['blank title', { ...guide, title: ' ' }],
      ['unexpected top-level field', { ...guide, unexpected: true }],
      ['blank presentation copy', { ...guide, presentation: { ...guide.presentation, cover_kicker: '' } }],
      ['blank paragraph', { ...guide, sections: [{ ...guide.sections[0], paragraphs: [' '] }, ...guide.sections.slice(1)] }],
      ['non-list section content', { ...guide, sections: [{ ...guide.sections[0], paragraphs: 'not a list' }, ...guide.sections.slice(1)] }],
      ['empty ordered list', { ...guide, sections: [{ title: '工具简介', ordered_items: [] }, ...guide.sections.slice(1)] }],
      ['unexpected section field', { ...guide, sections: [{ ...guide.sections[0], unknown: true }, ...guide.sections.slice(1)] }],
      ['path traversal stem', { ...guide, output_stem: '../escaped-user-guide' }],
      ['absolute path stem', { ...guide, output_stem: 'C:\\escaped-user-guide' }]
    ]

    for (const [name, value] of cases) {
      expect(validateGuide(value).status, name).not.toBe(0)
    }
  }, 60_000)

  it('fails with the canonical source path when a required section is missing', () => {
    const directory = mkdtempSync(join(tmpdir(), 'user-guide-'))
    const source = join(directory, 'missing-section.json')
    const invalidGuide = { ...guide, sections: guide.sections.filter((section: { title: string }) => section.title !== '常见问题') }
    writeFileSync(source, JSON.stringify(invalidGuide), 'utf8')
    const harness = [
      'import importlib.util, pathlib, sys',
      'spec = importlib.util.spec_from_file_location("guide_builder", sys.argv[1])',
      'module = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(module)',
      'module.SOURCE = pathlib.Path(sys.argv[2])',
      'raise SystemExit(module.main())'
    ].join('; ')
    const result = runPython(['-c', harness, script, source])
    rmSync(directory, { recursive: true, force: true })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('canonical source')
    expect(result.stderr).toContain(source)
    expect(result.stderr).toContain('常见问题')
  })
})
