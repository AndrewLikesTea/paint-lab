// @ts-check
/**
 * @typedef {object} Fail
 * @property {false} ok
 * @property {"a"|"b"} reason
 */
/** @returns {{ok: true, value: number} | Fail} */
function f() { return { ok: true, value: 1 }; }
const r = f();
if (!r.ok) { console.log(r.reason); } else { console.log(r.value); }
