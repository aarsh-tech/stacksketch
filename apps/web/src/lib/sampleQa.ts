/**
 * The QA overlay's sample: a design frame and a screenshot of the built page
 * that drifts from it in a few places (the heading's size, the gap above the
 * button, the badge's colour). Drawn as SVG so the sample costs no download.
 */

const card = (o: { heading: number; buttonY: number; badge: string; price: string }) => `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360">
  <rect width="480" height="360" fill="#f4f3f0"/>
  <rect x="40" y="32" width="400" height="296" rx="14" fill="#ffffff" stroke="#e0ddd8"/>
  <rect x="64" y="56" width="72" height="72" rx="10" fill="#e9d8cc"/>
  <text x="156" y="${80 + o.heading / 3}" font-family="Arial, Helvetica, sans-serif" font-size="${o.heading}" font-weight="700" fill="#211f1d">Linen shirt</text>
  <text x="156" y="112" font-family="Arial, Helvetica, sans-serif" font-size="14" fill="#5a5652">Relaxed fit · Sand</text>
  <rect x="352" y="60" width="64" height="24" rx="12" fill="${o.badge}"/>
  <text x="384" y="76.5" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="700" fill="#ffffff">NEW</text>
  <line x1="64" y1="156" x2="416" y2="156" stroke="#e0ddd8"/>
  <text x="64" y="196" font-family="Arial, Helvetica, sans-serif" font-size="14" fill="#5a5652">Price</text>
  <text x="416" y="196" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="#211f1d">${o.price}</text>
  <rect x="64" y="${o.buttonY}" width="352" height="48" rx="10" fill="#b24f28"/>
  <text x="240" y="${o.buttonY + 29.5}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="700" fill="#ffffff">Add to bag</text>
</svg>`

const url = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

export const SAMPLE_QA_DESIGN = { name: 'Product card (design).svg', src: url(card({ heading: 22, buttonY: 236, badge: '#2d7a4f', price: '$64.00' })) }
export const SAMPLE_QA_PAGE = { name: 'localhost-3000 (screenshot).svg', src: url(card({ heading: 26, buttonY: 248, badge: '#3b8a5f', price: '$64.00' })) }
