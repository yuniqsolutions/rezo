import { executeRequest } from '../adapters/http.js';
import { setGlobalAdapter, createRezoInstance, Rezo } from '../core/rezo.js';
setGlobalAdapter(executeRequest);
const rezo = createRezoInstance(executeRequest);

export { Rezo, rezo };
export default rezo;
