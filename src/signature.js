export function signaturePad(modal, name) {
  const paths = (modal.strokes || []).map(points => `<polyline points="${points.map(p => p.join(',')).join(' ')}"/>`).join('');
  return `<div class="signature signature-pad"><svg id="signature-pad" viewBox="0 0 400 130" role="img" aria-label="손가락이나 마우스로 계약서에 사인하세요">${paths}</svg>${modal.signatureMode === 'name' ? `<span class="signature-name">${name}</span>` : !paths ? '<span class="signature-hint">이곳에 직접 사인하세요</span>' : ''}</div>`;
}

export function bindSignature(root, getModal, render) {
  let active = null;
  const point = (event, svg) => {
    const rect = svg.getBoundingClientRect();
    return [Math.round(Math.max(0, Math.min(400, (event.clientX - rect.left) * 400 / rect.width))), Math.round(Math.max(0, Math.min(130, (event.clientY - rect.top) * 130 / rect.height)))];
  };
  root.addEventListener('pointerdown', event => {
    const svg = event.target.closest('#signature-pad'), modal = getModal();
    if (!svg || modal?.type !== 'contract' || event.button > 0) return;
    event.preventDefault(); svg.setPointerCapture(event.pointerId);
    if (modal.signatureMode === 'name') modal.strokes = [];
    modal.signatureMode = 'pen'; modal.signed = false; modal.strokes ||= [];
    root.querySelector('.signature-name, .signature-hint')?.remove();
    const points = [point(event, svg)]; modal.strokes.push(points);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline'); svg.append(line);
    active = { svg, line, points, modal, pointer: event.pointerId };
    root.querySelector('[data-action="sign"]').disabled = true;
  });
  root.addEventListener('pointermove', event => {
    if (!active || active.pointer !== event.pointerId || getModal() !== active.modal) return;
    event.preventDefault(); active.points.push(point(event, active.svg));
    active.line.setAttribute('points', active.points.map(p => p.join(',')).join(' '));
  });
  const finish = event => {
    if (!active || active.pointer !== event.pointerId) return;
    const modal = active.modal; active = null;
    if (getModal() !== modal) return;
    const distance = modal.strokes.reduce((total, stroke) => total + stroke.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - stroke[i][0], p[1] - stroke[i][1]), 0), 0);
    modal.signed = distance >= 12; render(true);
  };
  root.addEventListener('pointerup', finish); root.addEventListener('pointercancel', finish);
}
