// HyperLogLog（256 個暫存器，誤差約 6.5%）：數「每天約略不重複的機器」，只存暫存器、不存任何雜湊，所以不能還原回 IP 或裝置。
// 輸入是 64 位元（16 個十六進位字元以上）的雜湊：前 8 位元選暫存器，後面的前導零個數加一是排名。
const M = 256;
const newRegs = () => new Uint8Array(M);
function add(regs, hex) {
  const idx = parseInt(hex.slice(0, 2), 16), rest = BigInt(`0x${hex.slice(2, 16)}`);   // 後面 56 位元
  let rank = 1;
  for (let bit = 55n; bit >= 0n && !((rest >> bit) & 1n); bit--) rank++;
  if (rank > regs[idx]) regs[idx] = rank;
  return regs;
}
const merge = (a, b) => a.map((v, i) => Math.max(v, b[i]));
function estimate(regs) {
  const alpha = 0.7213 / (1 + 1.079 / M);
  let sum = 0, zeros = 0;
  for (const r of regs) { sum += 2 ** -r; if (!r) zeros++; }
  const e = (alpha * M * M) / sum;
  return Math.round(e <= 2.5 * M && zeros ? M * Math.log(M / zeros) : e);
}
const encode = regs => Buffer.from(regs).toString('base64');
const decode = b64 => { const b = Buffer.from(String(b64 || ''), 'base64'); return b.length === M ? new Uint8Array(b) : newRegs(); };

module.exports = { newRegs, add, merge, estimate, encode, decode, M };
