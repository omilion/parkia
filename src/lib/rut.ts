export function validateRut(rut: string) {
  const cleanRut = rut.replace(/\./g, '').replace(/-/g, '').toUpperCase();
  if (cleanRut.length < 2) return false;

  const body = cleanRut.slice(0, -1);
  const dv = cleanRut.slice(-1);

  if (!/^\d+$/.test(body)) return false;

  let sum = 0;
  let mul = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i]) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }

  const res = 11 - (sum % 11);
  const calculatedDv = res === 11 ? '0' : res === 10 ? 'K' : res.toString();

  return calculatedDv === dv;
}
