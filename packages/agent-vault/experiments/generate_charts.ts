#!/usr/bin/env tsx
/**
 * Agent Vault — Experiment Chart Generator
 *
 * Reads the latest experiment result JSON and generates SVG + PNG charts
 * for display in GitHub README.
 *
 * Usage:
 *   npx tsx experiments/generate_charts.ts
 *
 * Output:
 *   experiment-results/charts/*.svg
 *   experiment-results/charts/*.png
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RESULTS_DIR = path.resolve(__dirname, '..', 'experiment-results')
const CHARTS_DIR = path.resolve(RESULTS_DIR, 'charts')

// ── Colors ──────────────────────────────────────────────────────────────────
const COLORS = {
  pass: '#22c55e',
  fail: '#ef4444',
  info: '#3b82f6',
  security: '#8b5cf6',
  utility: '#f59e0b',
  redteam: '#ec4899',
  background: '#0f172a',
  card: '#1e293b',
  text: '#e2e8f0',
  textMuted: '#94a3b8',
  grid: '#334155',
  accent: '#38bdf8',
}

// ── Helpers ─────────────────────────────────────────────────────────────────

interface ExperimentReport {
  timestamp: string
  results: Array<{
    name: string
    category: 'security' | 'utility' | 'redteam'
    status: 'PASS' | 'FAIL' | 'INFO'
    details: string
    evidence?: string
  }>
}

function findLatestReport(): ExperimentReport | null {
  if (!fs.existsSync(RESULTS_DIR)) return null
  const files = fs.readdirSync(RESULTS_DIR)
    .filter(f => f.endsWith('.json') && !f.includes('charts'))
    .sort()
    .reverse()
  if (files.length === 0) return null
  const content = fs.readFileSync(path.join(RESULTS_DIR, files[0]), 'utf-8')
  return JSON.parse(content)
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>')
}

// ── SVG Components ──────────────────────────────────────────────────────────

function svgHeader(width: number, height: number, title: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${COLORS.background}"/>
      <stop offset="100%" stop-color="#0c1222"/>
    </linearGradient>
    <linearGradient id="pass-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#4ade80"/>
      <stop offset="100%" stop-color="${COLORS.pass}"/>
    </linearGradient>
    <linearGradient id="fail-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f87171"/>
      <stop offset="100%" stop-color="${COLORS.fail}"/>
    </linearGradient>
    <linearGradient id="security-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#a78bfa"/>
      <stop offset="100%" stop-color="${COLORS.security}"/>
    </linearGradient>
    <linearGradient id="utility-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fbbf24"/>
      <stop offset="100%" stop-color="${COLORS.utility}"/>
    </linearGradient>
    <filter id="shadow">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-opacity="0.3"/>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)" rx="12"/>
  <text x="24" y="36" font-family="system-ui, -apple-system, sans-serif" font-size="20" font-weight="700" fill="${COLORS.text}">${escapeXml(title)}</text>`
}

function svgFooter(): string {
  return `\n</svg>`
}

// ── Chart 1: Overall Pass/Fail Donut ────────────────────────────────────────

function generatePassFailDonut(report: ExperimentReport): string {
  const total = report.results.length
  const pass = report.results.filter(r => r.status === 'PASS').length
  const fail = report.results.filter(r => r.status === 'FAIL').length
  const info = report.results.filter(r => r.status === 'INFO').length

  const W = 400, H = 300
  const cx = 140, cy = 150, r = 80
  const passRate = total > 0 ? (pass / total) * 100 : 0
  const failRate = total > 0 ? (fail / total) * 100 : 0
  const infoRate = total > 0 ? (info / total) * 100 : 0

  // Convert percentages to arc angles
  const passAngle = (passRate / 100) * 360
  const failAngle = (failRate / 100) * 360
  const infoAngle = (infoRate / 100) * 360

  function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
    const startRad = ((startAngle - 90) * Math.PI) / 180
    const endRad = ((endAngle - 90) * Math.PI) / 180
    const x1 = cx + r * Math.cos(startRad)
    const y1 = cy + r * Math.sin(startRad)
    const x2 = cx + r * Math.cos(endRad)
    const y2 = cy + r * Math.sin(endRad)
    const largeArc = endAngle - startAngle > 180 ? 1 : 0
    return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`
  }

  let currentAngle = 0
  const slices: string[] = []

  if (passAngle > 0) {
    slices.push(`    <path d="${describeArc(cx, cy, r, currentAngle, currentAngle + passAngle)}" fill="url(#pass-grad)" opacity="0.9"/>`)
    currentAngle += passAngle
  }
  if (failAngle > 0) {
    slices.push(`    <path d="${describeArc(cx, cy, r, currentAngle, currentAngle + failAngle)}" fill="url(#fail-grad)" opacity="0.9"/>`)
    currentAngle += failAngle
  }
  if (infoAngle > 0) {
    slices.push(`    <path d="${describeArc(cx, cy, r, currentAngle, currentAngle + infoAngle)}" fill="${COLORS.info}" opacity="0.9"/>`)
  }

  // Center hole
  const centerCircle = `    <circle cx="${cx}" cy="${cy}" r="50" fill="${COLORS.card}"/>`
  const centerText = [
    `    <text x="${cx}" y="${cy - 8}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="28" font-weight="800" fill="${COLORS.text}">${passRate}%</text>`,
    `    <text x="${cx}" y="${cy + 16}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="12" fill="${COLORS.textMuted}">pass rate</text>`,
  ]

  // Legend
  const legendX = 250
  const legendItems = [
    { label: `Pass (${pass})`, color: COLORS.pass },
    { label: `Fail (${fail})`, color: COLORS.fail },
    { label: `Info (${info})`, color: COLORS.info },
  ]

  const legend = legendItems.map((item, i) => {
    const y = cy - 30 + i * 28
    return [
      `    <rect x="${legendX}" y="${y - 8}" width="12" height="12" rx="3" fill="${item.color}"/>`,
      `    <text x="${legendX + 20}" y="${y + 2}" font-family="system-ui, sans-serif" font-size="13" fill="${COLORS.text}">${escapeXml(item.label)}</text>`,
    ].join('\n')
  }).join('\n')

  return svgHeader(W, H, 'Overall Results') +
    '\n' + slices.join('\n') + '\n' + centerCircle + '\n' + centerText.join('\n') +
    '\n' + legend +
    svgFooter()
}

// ── Chart 2: Category Bar Chart ─────────────────────────────────────────────

function generateCategoryChart(report: ExperimentReport): string {
  const categories = ['security', 'utility', 'redteam'] as const
  const catLabels: Record<string, string> = { security: 'Security', utility: 'Utility', redteam: 'Red Team' }
  const catColors: Record<string, string> = { security: 'url(#security-grad)', utility: 'url(#utility-grad)', redteam: COLORS.redteam }

  const W = 500, H = 300
  const chartX = 120, chartY = 60, chartW = 340, chartH = 200
  const barCount = categories.length
  const barWidth = (chartW / barCount) * 0.6
  const barGap = (chartW / barCount) * 0.4
  const maxVal = Math.max(...categories.map(c => report.results.filter(r => r.category === c).length), 1)

  const lines: string[] = [svgHeader(W, H, 'Results by Category')]

  // Y-axis grid lines
  for (let i = 0; i <= 4; i++) {
    const y = chartY + chartH - (i / 4) * chartH
    const val = Math.round((i / 4) * maxVal)
    lines.push(`    <line x1="${chartX}" y1="${y}" x2="${chartX + chartW}" y2="${y}" stroke="${COLORS.grid}" stroke-width="1"/>`)
    lines.push(`    <text x="${chartX - 8}" y="${y + 4}" text-anchor="end" font-family="system-ui, sans-serif" font-size="11" fill="${COLORS.textMuted}">${val}</text>`)
  }

  // Bars
  categories.forEach((cat, i) => {
    const catResults = report.results.filter(r => r.category === cat)
    const pass = catResults.filter(r => r.status === 'PASS').length
    const fail = catResults.filter(r => r.status === 'FAIL').length
    const total = catResults.length
    const x = chartX + (i / barCount) * chartW + barGap / 2
    const barH = total > 0 ? (total / maxVal) * chartH : 0
    const passH = total > 0 ? (pass / total) * barH : 0
    const failH = total > 0 ? (fail / total) * barH : 0
    const barY = chartY + chartH - barH

    // Stacked bar
    if (failH > 0) {
      lines.push(`    <rect x="${x}" y="${chartY + chartH - failH}" width="${barWidth}" height="${failH}" fill="url(#fail-grad)" rx="3"/>`)
    }
    if (passH > 0) {
      lines.push(`    <rect x="${x}" y="${chartY + chartH - passH - failH}" width="${barWidth}" height="${passH}" fill="url(#pass-grad)" rx="3"/>`)
    }

    // Label
    lines.push(`    <text x="${x + barWidth / 2}" y="${chartY + chartH + 18}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="12" fill="${COLORS.text}">${catLabels[cat]}</text>`)
    // Count
    lines.push(`    <text x="${x + barWidth / 2}" y="${barY - 8}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="13" font-weight="700" fill="${COLORS.text}">${total}</text>`)
    // Pass/fail sub-label
    const subParts: string[] = []
    if (pass > 0) subParts.push(`<tspan fill="${COLORS.pass}">${pass}✓</tspan>`)
    if (fail > 0) subParts.push(`<tspan fill="${COLORS.fail}">${fail}✗</tspan>`)
    if (subParts.length > 0) {
      lines.push(`    <text x="${x + barWidth / 2}" y="${barY + 16}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="10">${subParts.join(' ')}</text>`)
    }
  })

  lines.push(svgFooter())
  return lines.join('\n')
}

// ── Chart 3: Security Test Detail (Redaction Radar) ─────────────────────────

function generateSecurityDetailChart(report: ExperimentReport): string {
  const securityTests = report.results.filter(r => r.category === 'security')
  const W = 600, H = 400
  const lines: string[] = [svgHeader(W, H, 'Security Test Results')]

  const startX = 30
  const startY = 60
  const rowH = 22
  const maxRows = Math.min(securityTests.length, 20)

  // Table header
  lines.push(`    <text x="${startX}" y="${startY - 8}" font-family="system-ui, sans-serif" font-size="11" font-weight="600" fill="${COLORS.textMuted}">TEST</text>`)
  lines.push(`    <text x="${startX + 350}" y="${startY - 8}" font-family="system-ui, sans-serif" font-size="11" font-weight="600" fill="${COLORS.textMuted}">STATUS</text>`)

  securityTests.slice(0, maxRows).forEach((test, i) => {
    const y = startY + i * rowH
    const isPass = test.status === 'PASS'
    const isEven = i % 2 === 0

    if (isEven) {
      lines.push(`    <rect x="${startX - 8}" y="${y - 14}" width="${W - 60}" height="${rowH}" rx="4" fill="white" opacity="0.03"/>`)
    }

    // Test name (truncated)
    const name = test.name.length > 45 ? test.name.substring(0, 42) + '...' : test.name
    lines.push(`    <text x="${startX}" y="${y}" font-family="system-ui, sans-serif" font-size="12" fill="${COLORS.text}">${escapeXml(name)}</text>`)

    // Status badge
    const badgeColor = isPass ? COLORS.pass : COLORS.fail
    const badgeText = isPass ? 'PASS' : 'FAIL'
    const badgeX = startX + 370
    lines.push(`    <rect x="${badgeX}" y="${y - 10}" width="52" height="18" rx="9" fill="${badgeColor}" opacity="0.15"/>`)
    lines.push(`    <text x="${badgeX + 26}" y="${y + 3}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="10" font-weight="700" fill="${badgeColor}">${badgeText}</text>`)
  })

  lines.push(svgFooter())
  return lines.join('\n')
}

// ── Chart 4: Redaction Coverage Heatmap ─────────────────────────────────────

function generateRedactionChart(report: ExperimentReport): string {
  const redactionTests = report.results.filter(r => r.name.includes('ST-5: Redact'))
  const W = 500, H = 300
  const lines: string[] = [svgHeader(W, H, 'Redaction Coverage')]

  const startX = 30
  const startY = 60
  const cols = 3
  const cellW = 140
  const cellH = 36
  const gapX = 12
  const gapY = 10

  redactionTests.forEach((test, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = startX + col * (cellW + gapX)
    const y = startY + row * (cellH + gapY)
    const isPass = test.status === 'PASS'

    // Extract the redacted item name from test name
    const itemName = test.name.replace('ST-5: Redact ', '')

    // Card background
    lines.push(`    <rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="6" fill="${COLORS.card}" stroke="${isPass ? COLORS.pass : COLORS.fail}" stroke-width="1.5" filter="url(#shadow)"/>`)

    // Icon
    const icon = isPass ? '✓' : '✗'
    const iconColor = isPass ? COLORS.pass : COLORS.fail
    lines.push(`    <text x="${x + 10}" y="${y + 23}" font-family="system-ui, sans-serif" font-size="14" font-weight="700" fill="${iconColor}">${icon}</text>`)

    // Label
    const label = itemName.length > 16 ? itemName.substring(0, 14) + '..' : itemName
    lines.push(`    <text x="${x + 30}" y="${y + 23}" font-family="system-ui, sans-serif" font-size="12" fill="${COLORS.text}">${escapeXml(label)}</text>`)
  })

  lines.push(svgFooter())
  return lines.join('\n')
}

// ── Chart 5: Policy Blocking Summary ────────────────────────────────────────

function generatePolicyChart(report: ExperimentReport): string {
  const policyTests = report.results.filter(r => r.name.includes('ST-4: Block'))
  const W = 500, H = 300
  const lines: string[] = [svgHeader(W, H, 'Dangerous Command Blocking')]

  const startX = 30
  const startY = 60
  const rowH = 24
  const maxRows = Math.min(policyTests.length, 12)

  // Header
  lines.push(`    <text x="${startX}" y="${startY - 8}" font-family="system-ui, sans-serif" font-size="11" font-weight="600" fill="${COLORS.textMuted}">COMMAND</text>`)
  lines.push(`    <text x="${startX + 350}" y="${startY - 8}" font-family="system-ui, sans-serif" font-size="11" font-weight="600" fill="${COLORS.textMuted}">BLOCKED</text>`)

  policyTests.slice(0, maxRows).forEach((test, i) => {
    const y = startY + i * rowH
    const isEven = i % 2 === 0

    if (isEven) {
      lines.push(`    <rect x="${startX - 8}" y="${y - 14}" width="${W - 60}" height="${rowH}" rx="4" fill="white" opacity="0.03"/>`)
    }

    // Command name
    const cmd = test.name.replace('ST-4: Block ', '').replace(/"/g, '')
    const display = cmd.length > 35 ? cmd.substring(0, 32) + '...' : cmd
    lines.push(`    <text x="${startX}" y="${y}" font-family="system-ui, sans-serif" font-size="12" fill="${COLORS.text}">${escapeXml(display)}</text>`)

    // Blocked badge
    const badgeX = startX + 370
    lines.push(`    <rect x="${badgeX}" y="${y - 10}" width="62" height="18" rx="9" fill="${COLORS.pass}" opacity="0.15"/>`)
    lines.push(`    <text x="${badgeX + 31}" y="${y + 3}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="10" font-weight="700" fill="${COLORS.pass}">BLOCKED</text>`)
  })

  lines.push(svgFooter())
  return lines.join('\n')
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('📊 Agent Vault — Chart Generator')
  console.log('')

  const report: ExperimentReport | null = findLatestReport()
  if (!report) {
    console.error('❌ No experiment results found in', RESULTS_DIR)
    process.exit(1)
    return
  }

  // The timestamp has '-' instead of ':' from file-safe naming, restore it for parsing
  const ts = report.timestamp.replace(/T(\d{2})-(\d{2})-(\d{2})-/, 'T$1:$2:$3.')
  console.log(`   Using report: ${ts}`)
  console.log(`   Tests: ${report.results.length} total`)
  console.log('')

  // Create charts directory
  if (!fs.existsSync(CHARTS_DIR)) {
    fs.mkdirSync(CHARTS_DIR, { recursive: true })
  }

  // Generate charts
  const charts: Array<{ name: string; generator: (r: ExperimentReport) => string }> = [
    { name: 'overall-pass-fail.svg', generator: generatePassFailDonut },
    { name: 'category-breakdown.svg', generator: generateCategoryChart },
    { name: 'security-detail.svg', generator: generateSecurityDetailChart },
    { name: 'redaction-coverage.svg', generator: generateRedactionChart },
    { name: 'policy-blocking.svg', generator: generatePolicyChart },
  ]

  for (const chart of charts) {
    const svg = chart.generator(report)
    const svgPath = path.join(CHARTS_DIR, chart.name)
    fs.writeFileSync(svgPath, svg)
    const sizeKb = (Buffer.byteLength(svg) / 1024).toFixed(1)
    console.log(`   ✅ Generated ${chart.name} (${sizeKb} KB)`)

    // Also generate PNG version using sharp
    try {
      const pngName = chart.name.replace(/\.svg$/, '.png')
      const pngPath = path.join(CHARTS_DIR, pngName)
      await sharp(Buffer.from(svg)).png().toFile(pngPath)
      const pngStat = fs.statSync(pngPath)
      const pngSizeKb = (pngStat.size / 1024).toFixed(1)
      console.log(`   ✅ Generated ${pngName} (${pngSizeKb} KB)`)
    } catch (err) {
      console.log(`   ⚠️  PNG generation skipped for ${chart.name}: ${err}`)
    }
  }

  console.log('')
  console.log(`   📁 Charts saved to: ${CHARTS_DIR}`)
  console.log('')
  console.log('   To embed in README, use:')
  console.log('   ```markdown')
  console.log(`   ![Overall Results](./experiment-results/charts/overall-pass-fail.png)`)
  console.log('   ```')
}

main()
