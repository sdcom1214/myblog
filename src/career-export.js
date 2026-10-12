import * as E from './engine.js';
import { careerEnding } from './ending.js';

// Render pixels, never navigate to a JSON blob when someone saves a career card.
export async function careerCardBlob(career, teamName) {
  await Promise.race([document.fonts?.ready || Promise.resolve(), new Promise(resolve => setTimeout(resolve, 2500))]);
  const canvas = document.createElement('canvas'); canvas.width = 780; canvas.height = 1180;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('카드 이미지를 만들 수 없습니다. Safari 또는 Chrome에서 다시 시도해 주세요.');
  ctx.scale(2, 2);
  const ending = career.stage === 'retired' ? careerEnding(career) : null, gold = !!ending?.honorClub, ink = gold ? '#806019' : '#263796';
  const loadImage = src => new Promise(resolve => { const img = new Image(), timeout = setTimeout(() => resolve(null), 2500); const finish = value => { clearTimeout(timeout); resolve(value); }; img.onload = () => finish(img); img.onerror = () => finish(null); img.src = src; });
  const box = (x, y, w, h, radius, color) => {
    const r = Math.min(radius, w / 2, h / 2); ctx.fillStyle = color; ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.closePath(); ctx.fill();
  };
  const text = (value, x, y, size, color = ink, weight = 600, align = 'left', width) => {
    ctx.fillStyle = color; ctx.textAlign = align; ctx.font = `${weight} ${size}px Pretendard, sans-serif`;
    if (width) while (ctx.measureText(String(value)).width > width && size > 11) ctx.font = `${weight} ${--size}px Pretendard, sans-serif`;
    ctx.fillText(String(value), x, y);
  };
  ctx.fillStyle = '#f3f6fc'; ctx.fillRect(0, 0, 390, 590); box(8, 8, 374, 574, 18, gold ? '#c6a35c' : '#293796');
  box(24, 25, 72, 72, 12, '#ffffff');
  const club = E.clubById(career.team || career.preferred);
  if (club) {
    const logo = await loadImage(`/clubs/${club.id}.png`);
    if (logo) { const ratio = Math.min(54 / logo.width, 54 / logo.height); ctx.drawImage(logo, 60 - logo.width * ratio / 2, 61 - logo.height * ratio / 2, logo.width * ratio, logo.height * ratio); }
    else text(club.initials, 60, 65, 20, '#263796', 800, 'center');
  }
  const identity = gold ? '#2c200a' : '#ffffff';
  text(career.name, 112, 48, 25, identity, 800, 'left', 248);
  text(teamName || career.school, 112, 69, 12, identity, 600, 'left', 248);
  text(`${E.POSITIONS[career.position]} · No.${career.number} · ${career.age}세`, 112, 90, 11, gold ? '#695322' : '#d5dcff');
  box(24, 113, 342, ending ? 91 : 59, 12, '#ffffff'); text('LEGACY SCORE', 38, 149, 12, ink, 800);
  text(`${E.legacy(career).toLocaleString()}점`, 351, 151, 24, ink, 800, 'right');
  if (ending) ending.score.items.forEach((item, i) => { const x = 58 + i * 67; text(item.label, x, 175, 8, '#657387', 600, 'center'); text(item.value.toLocaleString(), x, 193, 12, ink, 800, 'center'); });
  const abilityY = ending ? 216 : 184;
  box(24, abilityY, 342, ending ? 226 : 258, 12, '#ffffff'); text('PRIME ABILITY', 38, abilityY+26, 12, ink, 800);
  text(ending?.peakYears || `OVR ${career.peakOvr.toFixed(1)}`, 351, abilityY+26, 12, ink, 700, 'right');
  E.skillNames(career).forEach((name, i) => {
    const y = abilityY + 62 + i * (ending ? 36 : 43), value = Math.min(100, Math.round(career.peakSkills[i] * 5));
    const grade = value >= 90 ? 'S' : value >= 80 ? 'A' : value >= 70 ? 'B' : value >= 60 ? 'C' : value >= 50 ? 'D' : 'E';
    text(name, 38, y, 13, '#53617b'); text(value, 133, y, 16, '#243654', 800, 'right');
    box(143, y - 17, 25, 23, 5, value >= 80 ? '#4688ca' : value >= 70 ? '#20956e' : '#8190a2'); text(grade, 155.5, y, 12, '#ffffff', 700, 'center');
    box(183, y - 10, 168, 7, 4, gold ? '#f4e8c9' : '#e7ebf8'); box(183, y - 10, 168 * value / 100, 7, 4, ink);
  });
  const totals = E.totals(career), keeper = career.position === 'GK';
  box(24, 454, 342, 66, 12, '#ffffff');
  [['경기', totals.games], [keeper ? '선방' : '골', keeper ? totals.saves : totals.goals], [keeper ? '클린시트' : '도움', keeper ? totals.cleanSheets : totals.assists]].forEach(([label, value], i) => {
    text(label, 81 + 114 * i, 477, 11, '#657387', 600, 'center'); text(value.toLocaleString(), 81 + 114 * i, 503, 22, ink, 800, 'center');
  });
  text(`${career.proSeasons}번의 프로 시즌 · ${career.trophies.length}번의 리그 우승`, 195, 545, 12, identity, 600, 'center');
  text('SECOND LIFE FOOTBALL', 195, 567, 10, gold ? '#695322' : '#c8d3ff', 700, 'center');
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('카드 이미지를 만들지 못했습니다. 다시 시도해 주세요.')), 'image/png'));
}

export function imageDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('카드 이미지를 열지 못했습니다. 다시 시도해 주세요.'));
    reader.readAsDataURL(blob);
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
