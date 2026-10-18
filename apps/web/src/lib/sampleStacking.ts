/** The stacking inspector's sample: a modal with z-index 9999 that still sits behind a header with z-index 10. */
export const SAMPLE_STACKING_HTML = `<header class="site-header">
  <strong>Acme</strong>
  <nav>Orders · Customers · Settings</nav>
</header>

<main class="page">
  <section class="card">
    <h2>Order #1042</h2>
    <p>Paid, packing today.</p>

    <div class="modal" role="dialog">
      <strong>Cancel this order?</strong>
      <p>I have z-index: 9999, yet the header covers my top. Why?</p>
    </div>
  </section>
</main>
`

export const SAMPLE_STACKING_CSS = `body {
  margin: 0;
  font: 14px/1.5 system-ui, sans-serif;
  background: #f4f3f0;
  color: #211f1d;
}

.site-header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  gap: 24px;
  align-items: center;
  height: 56px;
  padding: 0 20px;
  background: #24324a;
  color: #fff;
}

.page { padding: 24px; }

/* the culprit: the slide-in animation leaves a transform behind,
   which starts a stacking context. Nothing inside .card can rise
   above the header, whatever its z-index. Delete it and scan again. */
.card {
  transform: translateY(0);
  position: relative;
  max-width: 420px;
  margin-top: 40px;
  padding: 16px 20px;
  background: #fff;
  border: 1px solid #e0ddd8;
  border-radius: 10px;
}

.modal {
  position: absolute;
  z-index: 9999;
  top: -50px;
  left: 120px;
  width: 260px;
  padding: 12px 16px;
  background: #fde8dd;
  border: 2px solid #b24f28;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.15);
}
`
