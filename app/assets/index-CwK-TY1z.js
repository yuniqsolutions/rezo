(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const r of document.querySelectorAll('link[rel="modulepreload"]'))o(r);new MutationObserver(r=>{for(const a of r)if(a.type==="childList")for(const i of a.addedNodes)i.tagName==="LINK"&&i.rel==="modulepreload"&&o(i)}).observe(document,{childList:!0,subtree:!0});function s(r){const a={};return r.integrity&&(a.integrity=r.integrity),r.referrerPolicy&&(a.referrerPolicy=r.referrerPolicy),r.crossOrigin==="use-credentials"?a.credentials="include":r.crossOrigin==="anonymous"?a.credentials="omit":a.credentials="same-origin",a}function o(r){if(r.ep)return;r.ep=!0;const a=s(r);fetch(r.href,a)}})();const qo=!1;var ar=Array.isArray,jn=Array.prototype.indexOf,mo=Array.from,aa=Object.defineProperty,vs=Object.getOwnPropertyDescriptor,na=Object.getOwnPropertyDescriptors,Un=Object.prototype,Fn=Array.prototype,nr=Object.getPrototypeOf,Pr=Object.isExtensible;function $n(e){return typeof e=="function"}const at=()=>{};function Gn(e){return e()}function Bo(e){for(var t=0;t<e.length;t++)e[t]()}function ia(){var e,t,s=new Promise((o,r)=>{e=o,t=r});return{promise:s,resolve:e,reject:t}}const Ne=2,ir=4,fo=8,Jn=1<<24,vt=16,Et=32,ss=64,vo=128,nt=512,Ee=1024,Ue=2048,gt=4096,Ve=8192,Ct=16384,go=32768,qt=65536,Nr=1<<17,cr=1<<18,Rs=1<<19,ca=1<<20,_t=1<<25,Yt=32768,jo=1<<21,lr=1<<22,Ht=1<<23,Vt=Symbol("$state"),Wn=Symbol("legacy props"),Zn=Symbol(""),ms=new class extends Error{name="StaleReactionError";message="The reaction that called `getAbortSignal()` was re-run or destroyed"};function Vn(e){throw new Error("https://svelte.dev/e/lifecycle_outside_component")}function Kn(){throw new Error("https://svelte.dev/e/async_derived_orphan")}function Xn(e){throw new Error("https://svelte.dev/e/effect_in_teardown")}function Qn(){throw new Error("https://svelte.dev/e/effect_in_unowned_derived")}function Yn(e){throw new Error("https://svelte.dev/e/effect_orphan")}function ei(){throw new Error("https://svelte.dev/e/effect_update_depth_exceeded")}function ti(e){throw new Error("https://svelte.dev/e/props_invalid_value")}function si(){throw new Error("https://svelte.dev/e/state_descriptors_fixed")}function oi(){throw new Error("https://svelte.dev/e/state_prototype_fixed")}function ri(){throw new Error("https://svelte.dev/e/state_unsafe_mutation")}function ai(){throw new Error("https://svelte.dev/e/svelte_boundary_reset_onerror")}const ni=1,ii=2,la=4,ci=8,li=16,di=2,pi=4,ui=8,hi=1,mi=2,fi=4,da=1,vi=2,De=Symbol(),gi="http://www.w3.org/1999/xhtml";function bi(){console.warn("https://svelte.dev/e/svelte_boundary_reset_noop")}function pa(e){return e===this.v}function ua(e,t){return e!=e?t==t:e!==t||e!==null&&typeof e=="object"||typeof e=="function"}function ha(e){return!ua(e,this.v)}let _s=!1,yi=!1;function xi(){_s=!0}let ue=null;function gs(e){ue=e}function he(e,t=!1,s){ue={p:ue,i:!1,c:null,e:null,s:e,x:null,l:_s&&!t?{s:null,u:null,$:[]}:null}}function me(e){var t=ue,s=t.e;if(s!==null){t.e=null;for(var o of s)Aa(o)}return t.i=!0,ue=t.p,{}}function Cs(){return!_s||ue!==null&&ue.l===null}let Wt=[];function ma(){var e=Wt;Wt=[],Bo(e)}function os(e){if(Wt.length===0&&!Hs){var t=Wt;queueMicrotask(()=>{t===Wt&&ma()})}Wt.push(e)}function wi(){for(;Wt.length>0;)ma()}function fa(e){var t=re;if(t===null)return se.f|=Ht,e;if((t.f&go)===0){if((t.f&vo)===0)throw e;t.b.error(e)}else bs(e,t)}function bs(e,t){for(;t!==null;){if((t.f&vo)!==0)try{t.b.error(e);return}catch(s){e=s}t=t.parent}throw e}const eo=new Set;let ne=null,ao=null,st=null,et=[],bo=null,Uo=!1,Hs=!1;class ut{committed=!1;current=new Map;previous=new Map;#e=new Set;#t=new Set;#o=0;#s=0;#c=null;#a=[];#r=[];skipped_effects=new Set;is_fork=!1;is_deferred(){return this.is_fork||this.#s>0}process(t){et=[],ao=null,this.apply();var s={parent:null,effect:null,effects:[],render_effects:[],block_effects:[]};for(const o of t)this.#n(o,s);this.is_fork||this.#d(),this.is_deferred()?(this.#i(s.effects),this.#i(s.render_effects),this.#i(s.block_effects)):(ao=this,ne=null,Mr(s.render_effects),Mr(s.effects),ao=null,this.#c?.resolve()),st=null}#n(t,s){t.f^=Ee;for(var o=t.first;o!==null;){var r=o.f,a=(r&(Et|ss))!==0,i=a&&(r&Ee)!==0,c=i||(r&Ve)!==0||this.skipped_effects.has(o);if((o.f&vo)!==0&&o.b?.is_pending()&&(s={parent:s,effect:o,effects:[],render_effects:[],block_effects:[]}),!c&&o.fn!==null){a?o.f^=Ee:(r&ir)!==0?s.effects.push(o):As(o)&&((o.f&vt)!==0&&s.block_effects.push(o),xs(o));var l=o.first;if(l!==null){o=l;continue}}var d=o.parent;for(o=o.next;o===null&&d!==null;)d===s.effect&&(this.#i(s.effects),this.#i(s.render_effects),this.#i(s.block_effects),s=s.parent),o=d.next,d=d.parent}}#i(t){for(const s of t)((s.f&Ue)!==0?this.#a:this.#r).push(s),this.#l(s.deps),Pe(s,Ee)}#l(t){if(t!==null)for(const s of t)(s.f&Ne)===0||(s.f&Yt)===0||(s.f^=Yt,this.#l(s.deps))}capture(t,s){this.previous.has(t)||this.previous.set(t,s),(t.f&Ht)===0&&(this.current.set(t,t.v),st?.set(t,t.v))}activate(){ne=this,this.apply()}deactivate(){ne===this&&(ne=null,st=null)}flush(){if(this.activate(),et.length>0){if(va(),ne!==null&&ne!==this)return}else this.#o===0&&this.process([]);this.deactivate()}discard(){for(const t of this.#t)t(this);this.#t.clear()}#d(){if(this.#s===0){for(const t of this.#e)t();this.#e.clear()}this.#o===0&&this.#p()}#p(){if(eo.size>1){this.previous.clear();var t=st,s=!0,o={parent:null,effect:null,effects:[],render_effects:[],block_effects:[]};for(const a of eo){if(a===this){s=!1;continue}const i=[];for(const[l,d]of this.current){if(a.current.has(l))if(s&&d!==a.current.get(l))a.current.set(l,d);else continue;i.push(l)}if(i.length===0)continue;const c=[...a.current.keys()].filter(l=>!this.current.has(l));if(c.length>0){var r=et;et=[];const l=new Set,d=new Map;for(const u of i)ga(u,c,l,d);if(et.length>0){ne=a,a.apply();for(const u of et)a.#n(u,o);a.deactivate()}et=r}}ne=null,st=t}this.committed=!0,eo.delete(this)}increment(t){this.#o+=1,t&&(this.#s+=1)}decrement(t){this.#o-=1,t&&(this.#s-=1),this.revive()}revive(){for(const t of this.#a)Pe(t,Ue),es(t);for(const t of this.#r)Pe(t,gt),es(t);this.#a=[],this.#r=[],this.flush()}oncommit(t){this.#e.add(t)}ondiscard(t){this.#t.add(t)}settled(){return(this.#c??=ia()).promise}static ensure(){if(ne===null){const t=ne=new ut;eo.add(ne),Hs||ut.enqueue(()=>{ne===t&&t.flush()})}return ne}static enqueue(t){os(t)}apply(){}}function ki(e){var t=Hs;Hs=!0;try{for(var s;;){if(wi(),et.length===0&&(ne?.flush(),et.length===0))return bo=null,s;va()}}finally{Hs=t}}function va(){var e=Xt;Uo=!0;var t=null;try{var s=0;for(co(!0);et.length>0;){var o=ut.ensure();if(s++>1e3){var r,a;Ri()}o.process(et),Lt.clear()}}finally{Uo=!1,co(e),bo=null}}function Ri(){try{ei()}catch(e){bs(e,bo)}}let wt=null;function Mr(e){var t=e.length;if(t!==0){for(var s=0;s<t;){var o=e[s++];if((o.f&(Ct|Ve))===0&&As(o)&&(wt=new Set,xs(o),o.deps===null&&o.first===null&&o.nodes===null&&(o.teardown===null&&o.ac===null?Pa(o):o.fn=null),wt?.size>0)){Lt.clear();for(const r of wt){if((r.f&(Ct|Ve))!==0)continue;const a=[r];let i=r.parent;for(;i!==null;)wt.has(i)&&(wt.delete(i),a.push(i)),i=i.parent;for(let c=a.length-1;c>=0;c--){const l=a[c];(l.f&(Ct|Ve))===0&&xs(l)}}wt.clear()}}wt=null}}function ga(e,t,s,o){if(!s.has(e)&&(s.add(e),e.reactions!==null))for(const r of e.reactions){const a=r.f;(a&Ne)!==0?ga(r,t,s,o):(a&(lr|vt))!==0&&(a&Ue)===0&&ba(r,t,o)&&(Pe(r,Ue),es(r))}}function ba(e,t,s){const o=s.get(e);if(o!==void 0)return o;if(e.deps!==null)for(const r of e.deps){if(t.includes(r))return!0;if((r.f&Ne)!==0&&ba(r,t,s))return s.set(r,!0),!0}return s.set(e,!1),!1}function es(e){for(var t=bo=e;t.parent!==null;){t=t.parent;var s=t.f;if(Uo&&t===re&&(s&vt)!==0&&(s&cr)===0)return;if((s&(ss|Et))!==0){if((s&Ee)===0)return;t.f^=Ee}}et.push(t)}function _i(e){let t=0,s=ts(0),o;return()=>{js()&&(C(s),Gs(()=>(t===0&&(o=Se(()=>e(()=>Ls(s)))),t+=1,()=>{os(()=>{t-=1,t===0&&(o?.(),o=void 0,Ls(s))})})))}}var Ci=qt|Rs|vo;function Si(e,t,s){new Ti(e,t,s)}class Ti{parent;#e=!1;#t;#o=null;#s;#c;#a;#r=null;#n=null;#i=null;#l=null;#d=null;#p=0;#u=0;#m=!1;#h=null;#y=_i(()=>(this.#h=ts(this.#p),()=>{this.#h=null}));constructor(t,s,o){this.#t=t,this.#s=s,this.#c=o,this.parent=re.b,this.#e=!!this.#s.pending,this.#a=Ts(()=>{re.b=this;{var r=this.#g();try{this.#r=tt(()=>o(r))}catch(a){this.error(a)}this.#u>0?this.#v():this.#e=!1}return()=>{this.#d?.remove()}},Ci)}#x(){try{this.#r=tt(()=>this.#c(this.#t))}catch(t){this.error(t)}this.#e=!1}#w(){const t=this.#s.pending;t&&(this.#n=tt(()=>t(this.#t)),ut.enqueue(()=>{var s=this.#g();this.#r=this.#f(()=>(ut.ensure(),tt(()=>this.#c(s)))),this.#u>0?this.#v():(Kt(this.#n,()=>{this.#n=null}),this.#e=!1)}))}#g(){var t=this.#t;return this.#e&&(this.#d=St(),this.#t.before(this.#d),t=this.#d),t}is_pending(){return this.#e||!!this.parent&&this.parent.is_pending()}has_pending_snippet(){return!!this.#s.pending}#f(t){var s=re,o=se,r=ue;ft(this.#a),Be(this.#a),gs(this.#a.ctx);try{return t()}catch(a){return fa(a),null}finally{ft(s),Be(o),gs(r)}}#v(){const t=this.#s.pending;this.#r!==null&&(this.#l=document.createDocumentFragment(),this.#l.append(this.#d),Da(this.#r,this.#l)),this.#n===null&&(this.#n=tt(()=>t(this.#t)))}#b(t){if(!this.has_pending_snippet()){this.parent&&this.parent.#b(t);return}this.#u+=t,this.#u===0&&(this.#e=!1,this.#n&&Kt(this.#n,()=>{this.#n=null}),this.#l&&(this.#t.before(this.#l),this.#l=null))}update_pending_count(t){this.#b(t),this.#p+=t,this.#h&&ys(this.#h,this.#p)}get_effect_pending(){return this.#y(),C(this.#h)}error(t){var s=this.#s.onerror;let o=this.#s.failed;if(this.#m||!s&&!o)throw t;this.#r&&(je(this.#r),this.#r=null),this.#n&&(je(this.#n),this.#n=null),this.#i&&(je(this.#i),this.#i=null);var r=!1,a=!1;const i=()=>{if(r){bi();return}r=!0,a&&ai(),ut.ensure(),this.#p=0,this.#i!==null&&Kt(this.#i,()=>{this.#i=null}),this.#e=this.has_pending_snippet(),this.#r=this.#f(()=>(this.#m=!1,tt(()=>this.#c(this.#t)))),this.#u>0?this.#v():this.#e=!1};var c=se;try{Be(null),a=!0,s?.(t,i),a=!1}catch(l){bs(l,this.#a&&this.#a.parent)}finally{Be(c)}o&&os(()=>{this.#i=this.#f(()=>{ut.ensure(),this.#m=!0;try{return tt(()=>{o(this.#t,()=>t,()=>i)})}catch(l){return bs(l,this.#a.parent),null}finally{this.#m=!1}})})}}function Ai(e,t,s,o){const r=Cs()?dr:pr;if(s.length===0&&e.length===0){o(t.map(r));return}var a=ne,i=re,c=Ei();function l(){Promise.all(s.map(d=>Ii(d))).then(d=>{c();try{o([...t.map(r),...d])}catch(u){(i.f&Ct)===0&&bs(u,i)}a?.deactivate(),no()}).catch(d=>{bs(d,i)})}e.length>0?Promise.all(e).then(()=>{c();try{return l()}finally{a?.deactivate(),no()}}):l()}function Ei(){var e=re,t=se,s=ue,o=ne;return function(a=!0){ft(e),Be(t),gs(s),a&&o?.activate()}}function no(){ft(null),Be(null),gs(null)}function dr(e){var t=Ne|Ue,s=se!==null&&(se.f&Ne)!==0?se:null;return re!==null&&(re.f|=Rs),{ctx:ue,deps:null,effects:null,equals:pa,f:t,fn:e,reactions:null,rv:0,v:De,wv:0,parent:s??re,ac:null}}function Ii(e,t){let s=re;s===null&&Kn();var o=s.b,r=void 0,a=ts(De),i=!se,c=new Map;return Bi(()=>{var l=ia();r=l.promise;try{Promise.resolve(e()).then(l.resolve,l.reject).then(()=>{d===ne&&d.committed&&d.deactivate(),no()})}catch(h){l.reject(h),no()}var d=ne;if(i){var u=!o.is_pending();o.update_pending_count(1),d.increment(u),c.get(d)?.reject(ms),c.delete(d),c.set(d,l)}const v=(h,g=void 0)=>{if(d.activate(),g)g!==ms&&(a.f|=Ht,ys(a,g));else{(a.f&Ht)!==0&&(a.f^=Ht),ys(a,h);for(const[y,x]of c){if(c.delete(y),y===d)break;x.reject(ms)}}i&&(o.update_pending_count(-1),d.decrement(u))};l.promise.then(v,h=>v(null,h||"unknown"))}),hr(()=>{for(const l of c.values())l.reject(ms)}),new Promise(l=>{function d(u){function v(){u===r?l(a):d(r)}u.then(v,v)}d(r)})}function pr(e){const t=dr(e);return t.equals=ha,t}function ya(e){var t=e.effects;if(t!==null){e.effects=null;for(var s=0;s<t.length;s+=1)je(t[s])}}function zi(e){for(var t=e.parent;t!==null;){if((t.f&Ne)===0)return(t.f&Ct)===0?t:null;t=t.parent}return null}function ur(e){var t,s=re;ft(zi(e));try{e.f&=~Yt,ya(e),t=qa(e)}finally{ft(s)}return t}function xa(e){var t=ur(e);if(e.equals(t)||(ne?.is_fork||(e.v=t),e.wv=Ha()),!rs)if(st!==null)(js()||ne?.is_fork)&&st.set(e,t);else{var s=(e.f&nt)===0?gt:Ee;Pe(e,s)}}let Fo=new Set;const Lt=new Map;let wa=!1;function ts(e,t){var s={f:0,v:e,reactions:null,equals:pa,rv:0,wv:0};return s}function Mt(e,t){const s=ts(e);return Ui(s),s}function Ke(e,t=!1,s=!0){const o=ts(e);return t||(o.equals=ha),_s&&s&&ue!==null&&ue.l!==null&&(ue.l.s??=[]).push(o),o}function de(e,t,s=!1){se!==null&&(!ht||(se.f&Nr)!==0)&&Cs()&&(se.f&(Ne|vt|lr|Nr))!==0&&!Tt?.includes(e)&&ri();let o=s?fs(t):t;return ys(e,o)}function ys(e,t){if(!e.equals(t)){var s=e.v;rs?Lt.set(e,t):Lt.set(e,s),e.v=t;var o=ut.ensure();o.capture(e,s),(e.f&Ne)!==0&&((e.f&Ue)!==0&&ur(e),Pe(e,(e.f&nt)!==0?Ee:gt)),e.wv=Ha(),ka(e,Ue),Cs()&&re!==null&&(re.f&Ee)!==0&&(re.f&(Et|ss))===0&&(Ye===null?Fi([e]):Ye.push(e)),!o.is_fork&&Fo.size>0&&!wa&&Pi()}return t}function Pi(){wa=!1;var e=Xt;co(!0);const t=Array.from(Fo);try{for(const s of t)(s.f&Ee)!==0&&Pe(s,gt),As(s)&&xs(s)}finally{co(e)}Fo.clear()}function Ls(e){de(e,e.v+1)}function ka(e,t){var s=e.reactions;if(s!==null)for(var o=Cs(),r=s.length,a=0;a<r;a++){var i=s[a],c=i.f;if(!(!o&&i===re)){var l=(c&Ue)===0;if(l&&Pe(i,t),(c&Ne)!==0){var d=i;st?.delete(d),(c&Yt)===0&&(c&nt&&(i.f|=Yt),ka(d,gt))}else l&&((c&vt)!==0&&wt!==null&&wt.add(i),es(i))}}}function fs(e){if(typeof e!="object"||e===null||Vt in e)return e;const t=nr(e);if(t!==Un&&t!==Fn)return e;var s=new Map,o=ar(e),r=Mt(0),a=Qt,i=c=>{if(Qt===a)return c();var l=se,d=Qt;Be(null),Hr(a);var u=c();return Be(l),Hr(d),u};return o&&s.set("length",Mt(e.length)),new Proxy(e,{defineProperty(c,l,d){(!("value"in d)||d.configurable===!1||d.enumerable===!1||d.writable===!1)&&si();var u=s.get(l);return u===void 0?u=i(()=>{var v=Mt(d.value);return s.set(l,v),v}):de(u,d.value,!0),!0},deleteProperty(c,l){var d=s.get(l);if(d===void 0){if(l in c){const u=i(()=>Mt(De));s.set(l,u),Ls(r)}}else de(d,De),Ls(r);return!0},get(c,l,d){if(l===Vt)return e;var u=s.get(l),v=l in c;if(u===void 0&&(!v||vs(c,l)?.writable)&&(u=i(()=>{var g=fs(v?c[l]:De),y=Mt(g);return y}),s.set(l,u)),u!==void 0){var h=C(u);return h===De?void 0:h}return Reflect.get(c,l,d)},getOwnPropertyDescriptor(c,l){var d=Reflect.getOwnPropertyDescriptor(c,l);if(d&&"value"in d){var u=s.get(l);u&&(d.value=C(u))}else if(d===void 0){var v=s.get(l),h=v?.v;if(v!==void 0&&h!==De)return{enumerable:!0,configurable:!0,value:h,writable:!0}}return d},has(c,l){if(l===Vt)return!0;var d=s.get(l),u=d!==void 0&&d.v!==De||Reflect.has(c,l);if(d!==void 0||re!==null&&(!u||vs(c,l)?.writable)){d===void 0&&(d=i(()=>{var h=u?fs(c[l]):De,g=Mt(h);return g}),s.set(l,d));var v=C(d);if(v===De)return!1}return u},set(c,l,d,u){var v=s.get(l),h=l in c;if(o&&l==="length")for(var g=d;g<v.v;g+=1){var y=s.get(g+"");y!==void 0?de(y,De):g in c&&(y=i(()=>Mt(De)),s.set(g+"",y))}if(v===void 0)(!h||vs(c,l)?.writable)&&(v=i(()=>Mt(void 0)),de(v,fs(d)),s.set(l,v));else{h=v.v!==De;var x=i(()=>fs(d));de(v,x)}var b=Reflect.getOwnPropertyDescriptor(c,l);if(b?.set&&b.set.call(u,d),!h){if(o&&typeof l=="string"){var k=s.get("length"),w=Number(l);Number.isInteger(w)&&w>=k.v&&de(k,w+1)}Ls(r)}return!0},ownKeys(c){C(r);var l=Reflect.ownKeys(c).filter(v=>{var h=s.get(v);return h===void 0||h.v!==De});for(var[d,u]of s)u.v!==De&&!(d in c)&&l.push(d);return l},setPrototypeOf(){oi()}})}var $o,F,Ra,_a,Ca;function Ni(){if($o===void 0){$o=window,F=document,Ra=/Firefox/.test(navigator.userAgent);var e=Element.prototype,t=Node.prototype,s=Text.prototype;_a=vs(t,"firstChild").get,Ca=vs(t,"nextSibling").get,Pr(e)&&(e.__click=void 0,e.__className=void 0,e.__attributes=null,e.__style=void 0,e.__e=void 0),Pr(s)&&(s.__t=void 0)}}function St(e=""){return document.createTextNode(e)}function We(e){return _a.call(e)}function $s(e){return Ca.call(e)}function p(e,t){return We(e)}function io(e,t=!1){{var s=We(e);return s instanceof Comment&&s.data===""?$s(s):s}}function n(e,t=1,s=!1){let o=e;for(;t--;)o=$s(o);return o}function Mi(e){e.textContent=""}function Sa(){return!1}let Dr=!1;function Di(){Dr||(Dr=!0,document.addEventListener("reset",e=>{Promise.resolve().then(()=>{if(!e.defaultPrevented)for(const t of e.target.elements)t.__on_r?.()})},{capture:!0}))}function Ss(e){var t=se,s=re;Be(null),ft(null);try{return e()}finally{Be(t),ft(s)}}function Oi(e,t,s,o=s){e.addEventListener(t,()=>Ss(s));const r=e.__on_r;r?e.__on_r=()=>{r(),o(!0)}:e.__on_r=()=>o(!0),Di()}function Ta(e){re===null&&(se===null&&Yn(),Qn()),rs&&Xn()}function Hi(e,t){var s=t.last;s===null?t.last=t.first=e:(s.next=e,e.prev=s,t.last=e)}function bt(e,t,s){var o=re;o!==null&&(o.f&Ve)!==0&&(e|=Ve);var r={ctx:ue,deps:null,nodes:null,f:e|Ue|nt,first:null,fn:t,last:null,next:null,parent:o,b:o&&o.b,prev:null,teardown:null,wv:0,ac:null};if(s)try{xs(r),r.f|=go}catch(c){throw je(r),c}else t!==null&&es(r);var a=r;if(s&&a.deps===null&&a.teardown===null&&a.nodes===null&&a.first===a.last&&(a.f&Rs)===0&&(a=a.first,(e&vt)!==0&&(e&qt)!==0&&a!==null&&(a.f|=qt)),a!==null&&(a.parent=o,o!==null&&Hi(a,o),se!==null&&(se.f&Ne)!==0&&(e&ss)===0)){var i=se;(i.effects??=[]).push(a)}return r}function js(){return se!==null&&!ht}function hr(e){const t=bt(fo,null,!1);return Pe(t,Ee),t.teardown=e,t}function Go(e){Ta();var t=re.f,s=!se&&(t&Et)!==0&&(t&go)===0;if(s){var o=ue;(o.e??=[]).push(e)}else return Aa(e)}function Aa(e){return bt(ir|ca,e,!1)}function Li(e){return Ta(),bt(fo|ca,e,!0)}function qi(e){ut.ensure();const t=bt(ss|Rs,e,!0);return(s={})=>new Promise(o=>{s.outro?Kt(t,()=>{je(t),o(void 0)}):(je(t),o(void 0))})}function U(e){return bt(ir,e,!1)}function qs(e,t){var s=ue,o={effect:null,ran:!1,deps:e};s.l.$.push(o),o.effect=Gs(()=>{e(),!o.ran&&(o.ran=!0,Se(t))})}function mr(){var e=ue;Gs(()=>{for(var t of e.l.$){t.deps();var s=t.effect;(s.f&Ee)!==0&&Pe(s,gt),As(s)&&xs(s),t.ran=!1}})}function Bi(e){return bt(lr|Rs,e,!0)}function Gs(e,t=0){return bt(fo|t,e,!0)}function pe(e,t=[],s=[],o=[]){Ai(o,t,s,r=>{bt(fo,()=>e(...r.map(C)),!0)})}function Ts(e,t=0){var s=bt(vt|t,e,!0);return s}function tt(e){return bt(Et|Rs,e,!0)}function Ea(e){var t=e.teardown;if(t!==null){const s=rs,o=se;Or(!0),Be(null);try{t.call(null)}finally{Or(s),Be(o)}}}function Ia(e,t=!1){var s=e.first;for(e.first=e.last=null;s!==null;){const r=s.ac;r!==null&&Ss(()=>{r.abort(ms)});var o=s.next;(s.f&ss)!==0?s.parent=null:je(s,t),s=o}}function ji(e){for(var t=e.first;t!==null;){var s=t.next;(t.f&Et)===0&&je(t),t=s}}function je(e,t=!0){var s=!1;(t||(e.f&cr)!==0)&&e.nodes!==null&&e.nodes.end!==null&&(za(e.nodes.start,e.nodes.end),s=!0),Ia(e,t&&!s),lo(e,0),Pe(e,Ct);var o=e.nodes&&e.nodes.t;if(o!==null)for(const a of o)a.stop();Ea(e);var r=e.parent;r!==null&&r.first!==null&&Pa(e),e.next=e.prev=e.teardown=e.ctx=e.deps=e.fn=e.nodes=e.ac=null}function za(e,t){for(;e!==null;){var s=e===t?null:$s(e);e.remove(),e=s}}function Pa(e){var t=e.parent,s=e.prev,o=e.next;s!==null&&(s.next=o),o!==null&&(o.prev=s),t!==null&&(t.first===e&&(t.first=o),t.last===e&&(t.last=s))}function Kt(e,t,s=!0){var o=[];Na(e,o,!0);var r=()=>{s&&je(e),t&&t()},a=o.length;if(a>0){var i=()=>--a||r();for(var c of o)c.out(i)}else r()}function Na(e,t,s){if((e.f&Ve)===0){e.f^=Ve;var o=e.nodes&&e.nodes.t;if(o!==null)for(const c of o)(c.is_global||s)&&t.push(c);for(var r=e.first;r!==null;){var a=r.next,i=(r.f&qt)!==0||(r.f&Et)!==0&&(e.f&vt)!==0;Na(r,t,i?s:!1),r=a}}}function fr(e){Ma(e,!0)}function Ma(e,t){if((e.f&Ve)!==0){e.f^=Ve,(e.f&Ee)===0&&(Pe(e,Ue),es(e));for(var s=e.first;s!==null;){var o=s.next,r=(s.f&qt)!==0||(s.f&Et)!==0;Ma(s,r?t:!1),s=o}var a=e.nodes&&e.nodes.t;if(a!==null)for(const i of a)(i.is_global||t)&&i.in()}}function Da(e,t){if(e.nodes)for(var s=e.nodes.start,o=e.nodes.end;s!==null;){var r=s===o?null:$s(s);t.append(s),s=r}}let Xt=!1;function co(e){Xt=e}let rs=!1;function Or(e){rs=e}let se=null,ht=!1;function Be(e){se=e}let re=null;function ft(e){re=e}let Tt=null;function Ui(e){se!==null&&(Tt===null?Tt=[e]:Tt.push(e))}let He=null,Ge=0,Ye=null;function Fi(e){Ye=e}let Oa=1,Us=0,Qt=Us;function Hr(e){Qt=e}function Ha(){return++Oa}function As(e){var t=e.f;if((t&Ue)!==0)return!0;if(t&Ne&&(e.f&=~Yt),(t&gt)!==0){var s=e.deps;if(s!==null)for(var o=s.length,r=0;r<o;r++){var a=s[r];if(As(a)&&xa(a),a.wv>e.wv)return!0}(t&nt)!==0&&st===null&&Pe(e,Ee)}return!1}function La(e,t,s=!0){var o=e.reactions;if(o!==null&&!Tt?.includes(e))for(var r=0;r<o.length;r++){var a=o[r];(a.f&Ne)!==0?La(a,t,!1):t===a&&(s?Pe(a,Ue):(a.f&Ee)!==0&&Pe(a,gt),es(a))}}function qa(e){var t=He,s=Ge,o=Ye,r=se,a=Tt,i=ue,c=ht,l=Qt,d=e.f;He=null,Ge=0,Ye=null,se=(d&(Et|ss))===0?e:null,Tt=null,gs(e.ctx),ht=!1,Qt=++Us,e.ac!==null&&(Ss(()=>{e.ac.abort(ms)}),e.ac=null);try{e.f|=jo;var u=e.fn,v=u(),h=e.deps;if(He!==null){var g;if(lo(e,Ge),h!==null&&Ge>0)for(h.length=Ge+He.length,g=0;g<He.length;g++)h[Ge+g]=He[g];else e.deps=h=He;if(js()&&(e.f&nt)!==0)for(g=Ge;g<h.length;g++)(h[g].reactions??=[]).push(e)}else h!==null&&Ge<h.length&&(lo(e,Ge),h.length=Ge);if(Cs()&&Ye!==null&&!ht&&h!==null&&(e.f&(Ne|gt|Ue))===0)for(g=0;g<Ye.length;g++)La(Ye[g],e);return r!==null&&r!==e&&(Us++,Ye!==null&&(o===null?o=Ye:o.push(...Ye))),(e.f&Ht)!==0&&(e.f^=Ht),v}catch(y){return fa(y)}finally{e.f^=jo,He=t,Ge=s,Ye=o,se=r,Tt=a,gs(i),ht=c,Qt=l}}function $i(e,t){let s=t.reactions;if(s!==null){var o=jn.call(s,e);if(o!==-1){var r=s.length-1;r===0?s=t.reactions=null:(s[o]=s[r],s.pop())}}s===null&&(t.f&Ne)!==0&&(He===null||!He.includes(t))&&(Pe(t,gt),(t.f&nt)!==0&&(t.f^=nt,t.f&=~Yt),ya(t),lo(t,0))}function lo(e,t){var s=e.deps;if(s!==null)for(var o=t;o<s.length;o++)$i(e,s[o])}function xs(e){var t=e.f;if((t&Ct)===0){Pe(e,Ee);var s=re,o=Xt;re=e,Xt=!0;try{(t&(vt|Jn))!==0?ji(e):Ia(e),Ea(e);var r=qa(e);e.teardown=typeof r=="function"?r:null,e.wv=Oa;var a;qo&&yi&&(e.f&Ue)!==0&&e.deps}finally{Xt=o,re=s}}}async function Gi(){await Promise.resolve(),ki()}function C(e){var t=e.f,s=(t&Ne)!==0;if(se!==null&&!ht){var o=re!==null&&(re.f&Ct)!==0;if(!o&&!Tt?.includes(e)){var r=se.deps;if((se.f&jo)!==0)e.rv<Us&&(e.rv=Us,He===null&&r!==null&&r[Ge]===e?Ge++:He===null?He=[e]:He.includes(e)||He.push(e));else{(se.deps??=[]).push(e);var a=e.reactions;a===null?e.reactions=[se]:a.includes(se)||a.push(se)}}}if(rs){if(Lt.has(e))return Lt.get(e);if(s){var i=e,c=i.v;return((i.f&Ee)===0&&i.reactions!==null||ja(i))&&(c=ur(i)),Lt.set(i,c),c}}else s&&(!st?.has(e)||ne?.is_fork&&!js())&&(i=e,As(i)&&xa(i),Xt&&js()&&(i.f&nt)===0&&Ba(i));if(st?.has(e))return st.get(e);if((e.f&Ht)!==0)throw e.v;return e.v}function Ba(e){if(e.deps!==null){e.f^=nt;for(const t of e.deps)(t.reactions??=[]).push(e),(t.f&Ne)!==0&&(t.f&nt)===0&&Ba(t)}}function ja(e){if(e.v===De)return!0;if(e.deps===null)return!1;for(const t of e.deps)if(Lt.has(t)||(t.f&Ne)!==0&&ja(t))return!0;return!1}function Se(e){var t=ht;try{return ht=!0,e()}finally{ht=t}}const Ji=-7169;function Pe(e,t){e.f=e.f&Ji|t}function Ua(e){if(!(typeof e!="object"||!e||e instanceof EventTarget)){if(Vt in e)Jo(e);else if(!Array.isArray(e))for(let t in e){const s=e[t];typeof s=="object"&&s&&Vt in s&&Jo(s)}}}function Jo(e,t=new Set){if(typeof e=="object"&&e!==null&&!(e instanceof EventTarget)&&!t.has(e)){t.add(e),e instanceof Date&&e.getTime();for(let o in e)try{Jo(e[o],t)}catch{}const s=nr(e);if(s!==Object.prototype&&s!==Array.prototype&&s!==Map.prototype&&s!==Set.prototype&&s!==Date.prototype){const o=na(s);for(let r in o){const a=o[r].get;if(a)try{a.call(e)}catch{}}}}}const Wi=["touchstart","touchmove"];function Zi(e){return Wi.includes(e)}const Vi=new Set,Lr=new Set;function Ki(e,t,s,o={}){function r(a){if(o.capture||Ms.call(t,a),!a.cancelBubble)return Ss(()=>s?.call(this,a))}return e.startsWith("pointer")||e.startsWith("touch")||e==="wheel"?os(()=>{t.addEventListener(e,r,o)}):t.addEventListener(e,r,o),r}function ee(e,t,s,o,r){var a={capture:o,passive:r},i=Ki(e,t,s,a);(t===document.body||t===window||t===document||t instanceof HTMLMediaElement)&&hr(()=>{t.removeEventListener(e,i,a)})}let qr=null;function Ms(e){var t=this,s=t.ownerDocument,o=e.type,r=e.composedPath?.()||[],a=r[0]||e.target;qr=e;var i=0,c=qr===e&&e.__root;if(c){var l=r.indexOf(c);if(l!==-1&&(t===document||t===window)){e.__root=t;return}var d=r.indexOf(t);if(d===-1)return;l<=d&&(i=l)}if(a=r[i]||e.target,a!==t){aa(e,"currentTarget",{configurable:!0,get(){return a||s}});var u=se,v=re;Be(null),ft(null);try{for(var h,g=[];a!==null;){var y=a.assignedSlot||a.parentNode||a.host||null;try{var x=a["__"+o];x!=null&&(!a.disabled||e.target===a)&&x.call(a,e)}catch(b){h?g.push(b):h=b}if(e.cancelBubble||y===t||y===null)break;a=y}if(h){for(let b of g)queueMicrotask(()=>{throw b});throw h}}finally{e.__root=t,delete e.currentTarget,Be(u),ft(v)}}}function vr(e){var t=document.createElement("template");return t.innerHTML=e.replaceAll("<!>","<!---->"),t.content}function ws(e,t){var s=re;s.nodes===null&&(s.nodes={start:e,end:t,a:null,t:null})}function N(e,t){var s=(t&da)!==0,o=(t&vi)!==0,r,a=!e.startsWith("<!>");return()=>{r===void 0&&(r=vr(a?e:"<!>"+e),s||(r=We(r)));var i=o||Ra?document.importNode(r,!0):r.cloneNode(!0);if(s){var c=We(i),l=i.lastChild;ws(c,l)}else ws(i,i);return i}}function Xi(e,t,s="svg"){var o=!e.startsWith("<!>"),r=(t&da)!==0,a=`<${s}>${o?e:"<!>"+e}</${s}>`,i;return()=>{if(!i){var c=vr(a),l=We(c);if(r)for(i=document.createDocumentFragment();We(l);)i.appendChild(We(l));else i=We(l)}var d=i.cloneNode(!0);if(r){var u=We(d),v=d.lastChild;ws(u,v)}else ws(d,d);return d}}function as(e,t){return Xi(e,t,"svg")}function Wo(){var e=document.createDocumentFragment(),t=document.createComment(""),s=St();return e.append(t,s),ws(t,s),e}function E(e,t){e!==null&&e.before(t)}let Zo=!0;function Q(e,t){var s=t==null?"":typeof t=="object"?t+"":t;s!==(e.__t??=e.nodeValue)&&(e.__t=s,e.nodeValue=s+"")}function Qi(e,t){return Yi(e,t)}const ps=new Map;function Yi(e,{target:t,anchor:s,props:o={},events:r,context:a,intro:i=!0}){Ni();var c=new Set,l=v=>{for(var h=0;h<v.length;h++){var g=v[h];if(!c.has(g)){c.add(g);var y=Zi(g);t.addEventListener(g,Ms,{passive:y});var x=ps.get(g);x===void 0?(document.addEventListener(g,Ms,{passive:y}),ps.set(g,1)):ps.set(g,x+1)}}};l(mo(Vi)),Lr.add(l);var d=void 0,u=qi(()=>{var v=s??t.appendChild(St());return Si(v,{pending:()=>{}},h=>{if(a){he({});var g=ue;g.c=a}r&&(o.$$events=r),Zo=i,d=e(h,o)||{},Zo=!0,a&&me()}),()=>{for(var h of c){t.removeEventListener(h,Ms);var g=ps.get(h);--g===0?(document.removeEventListener(h,Ms),ps.delete(h)):ps.set(h,g)}Lr.delete(l),v!==s&&v.parentNode?.removeChild(v)}});return ec.set(d,u),d}let ec=new WeakMap;class gr{anchor;#e=new Map;#t=new Map;#o=new Map;#s=new Set;#c=!0;constructor(t,s=!0){this.anchor=t,this.#c=s}#a=()=>{var t=ne;if(this.#e.has(t)){var s=this.#e.get(t),o=this.#t.get(s);if(o)fr(o),this.#s.delete(s);else{var r=this.#o.get(s);r&&(this.#t.set(s,r.effect),this.#o.delete(s),r.fragment.lastChild.remove(),this.anchor.before(r.fragment),o=r.effect)}for(const[a,i]of this.#e){if(this.#e.delete(a),a===t)break;const c=this.#o.get(i);c&&(je(c.effect),this.#o.delete(i))}for(const[a,i]of this.#t){if(a===s||this.#s.has(a))continue;const c=()=>{if(Array.from(this.#e.values()).includes(a)){var d=document.createDocumentFragment();Da(i,d),d.append(St()),this.#o.set(a,{effect:i,fragment:d})}else je(i);this.#s.delete(a),this.#t.delete(a)};this.#c||!o?(this.#s.add(a),Kt(i,c,!1)):c()}}};#r=t=>{this.#e.delete(t);const s=Array.from(this.#e.values());for(const[o,r]of this.#o)s.includes(o)||(je(r.effect),this.#o.delete(o))};ensure(t,s){var o=ne,r=Sa();if(s&&!this.#t.has(t)&&!this.#o.has(t))if(r){var a=document.createDocumentFragment(),i=St();a.append(i),this.#o.set(t,{effect:tt(()=>s(i)),fragment:a})}else this.#t.set(t,tt(()=>s(this.anchor)));if(this.#e.set(o,t),r){for(const[c,l]of this.#t)c===t?o.skipped_effects.delete(l):o.skipped_effects.add(l);for(const[c,l]of this.#o)c===t?o.skipped_effects.delete(l.effect):o.skipped_effects.add(l.effect);o.oncommit(this.#a),o.ondiscard(this.#r)}else this.#a()}}function Ze(e,t,s=!1){var o=new gr(e),r=s?qt:0;function a(i,c){o.ensure(i,c)}Ts(()=>{var i=!1;t((c,l=!0)=>{i=!0,a(l,c)}),i||a(!1,null)},r)}function tc(e,t,s){var o=new gr(e),r=!Cs();Ts(()=>{var a=t();r&&a!==null&&typeof a=="object"&&(a={}),o.ensure(a,s)})}function Ie(e,t){return t}function sc(e,t,s){for(var o=[],r=t.length,a,i=t.length,c=0;c<r;c++){let v=t[c];Kt(v,()=>{if(a){if(a.pending.delete(v),a.done.add(v),a.pending.size===0){var h=e.outrogroups;Vo(mo(a.done)),h.delete(a),h.size===0&&(e.outrogroups=null)}}else i-=1},!1)}if(i===0){var l=o.length===0&&s!==null;if(l){var d=s,u=d.parentNode;Mi(u),u.append(d),e.items.clear()}Vo(t,!l)}else a={pending:new Set(t),done:new Set},(e.outrogroups??=new Set).add(a)}function Vo(e,t=!0){for(var s=0;s<e.length;s++)je(e[s],t)}var Br;function ze(e,t,s,o,r,a=null){var i=e,c=new Map,l=(t&la)!==0;if(l){var d=e;i=d.appendChild(St())}var u=null,v=pr(()=>{var k=s();return ar(k)?k:k==null?[]:mo(k)}),h,g=!0;function y(){b.fallback=u,oc(b,h,i,t,o),u!==null&&(h.length===0?(u.f&_t)===0?fr(u):(u.f^=_t,Ds(u,null,i)):Kt(u,()=>{u=null}))}var x=Ts(()=>{h=C(v);for(var k=h.length,w=new Set,_=ne,S=Sa(),P=0;P<k;P+=1){var I=h[P],T=o(I,P),A=g?null:c.get(T);A?(A.v&&ys(A.v,I),A.i&&ys(A.i,P),S&&_.skipped_effects.delete(A.e)):(A=rc(c,g?i:Br??=St(),I,T,P,r,t,s),g||(A.e.f|=_t),c.set(T,A)),w.add(T)}if(k===0&&a&&!u&&(g?u=tt(()=>a(i)):(u=tt(()=>a(Br??=St())),u.f|=_t)),!g)if(S){for(const[O,Z]of c)w.has(O)||_.skipped_effects.add(Z.e);_.oncommit(y),_.ondiscard(()=>{})}else y();C(v)}),b={effect:x,items:c,outrogroups:null,fallback:u};g=!1}function oc(e,t,s,o,r){var a=(o&ci)!==0,i=t.length,c=e.items,l=e.effect.first,d,u=null,v,h=[],g=[],y,x,b,k;if(a)for(k=0;k<i;k+=1)y=t[k],x=r(y,k),b=c.get(x).e,(b.f&_t)===0&&(b.nodes?.a?.measure(),(v??=new Set).add(b));for(k=0;k<i;k+=1){if(y=t[k],x=r(y,k),b=c.get(x).e,e.outrogroups!==null)for(const Z of e.outrogroups)Z.pending.delete(b),Z.done.delete(b);if((b.f&_t)!==0)if(b.f^=_t,b===l)Ds(b,null,s);else{var w=u?u.next:l;b===e.effect.last&&(e.effect.last=b.prev),b.prev&&(b.prev.next=b.next),b.next&&(b.next.prev=b.prev),Dt(e,u,b),Dt(e,b,w),Ds(b,w,s),u=b,h=[],g=[],l=u.next;continue}if((b.f&Ve)!==0&&(fr(b),a&&(b.nodes?.a?.unfix(),(v??=new Set).delete(b))),b!==l){if(d!==void 0&&d.has(b)){if(h.length<g.length){var _=g[0],S;u=_.prev;var P=h[0],I=h[h.length-1];for(S=0;S<h.length;S+=1)Ds(h[S],_,s);for(S=0;S<g.length;S+=1)d.delete(g[S]);Dt(e,P.prev,I.next),Dt(e,u,P),Dt(e,I,_),l=_,u=I,k-=1,h=[],g=[]}else d.delete(b),Ds(b,l,s),Dt(e,b.prev,b.next),Dt(e,b,u===null?e.effect.first:u.next),Dt(e,u,b),u=b;continue}for(h=[],g=[];l!==null&&l!==b;)(d??=new Set).add(l),g.push(l),l=l.next;if(l===null)continue}(b.f&_t)===0&&h.push(b),u=b,l=b.next}if(e.outrogroups!==null){for(const Z of e.outrogroups)Z.pending.size===0&&(Vo(mo(Z.done)),e.outrogroups?.delete(Z));e.outrogroups.size===0&&(e.outrogroups=null)}if(l!==null||d!==void 0){var T=[];if(d!==void 0)for(b of d)(b.f&Ve)===0&&T.push(b);for(;l!==null;)(l.f&Ve)===0&&l!==e.fallback&&T.push(l),l=l.next;var A=T.length;if(A>0){var O=(o&la)!==0&&i===0?s:null;if(a){for(k=0;k<A;k+=1)T[k].nodes?.a?.measure();for(k=0;k<A;k+=1)T[k].nodes?.a?.fix()}sc(e,T,O)}}a&&os(()=>{if(v!==void 0)for(b of v)b.nodes?.a?.apply()})}function rc(e,t,s,o,r,a,i,c){var l=(i&ni)!==0?(i&li)===0?Ke(s,!1,!1):ts(s):null,d=(i&ii)!==0?ts(r):null;return{v:l,i:d,e:tt(()=>(a(t,l??s,d??r,c),()=>{e.delete(o)}))}}function Ds(e,t,s){if(e.nodes)for(var o=e.nodes.start,r=e.nodes.end,a=t&&(t.f&_t)===0?t.nodes.start:s;o!==null;){var i=$s(o);if(a.before(o),o===r)return;o=i}}function Dt(e,t,s){t===null?e.effect.first=s:t.next=s,s===null?e.effect.last=t:s.prev=t}function ac(e,t,s=!1,o=!1,r=!1){var a=e,i="";pe(()=>{var c=re;if(i!==(i=t()??"")&&(c.nodes!==null&&(za(c.nodes.start,c.nodes.end),c.nodes=null),i!=="")){var l=i+"";s?l=`<svg>${l}</svg>`:o&&(l=`<math>${l}</math>`);var d=vr(l);if((s||o)&&(d=We(d)),ws(We(d),d.lastChild),s||o)for(;We(d);)a.before(We(d));else a.before(d)}})}function nc(e,t,s,o,r){var a=t.$$slots?.[s],i=!1;a===!0&&(a=t.children,i=!0),a===void 0||a(e,i?()=>o:o)}function ic(e,t,s){var o=new gr(e);Ts(()=>{var r=t()??null;o.ensure(r,r&&(a=>s(a,r)))},qt)}const cc=()=>performance.now(),Rt={tick:e=>requestAnimationFrame(e),now:()=>cc(),tasks:new Set};function Fa(){const e=Rt.now();Rt.tasks.forEach(t=>{t.c(e)||(Rt.tasks.delete(t),t.f())}),Rt.tasks.size!==0&&Rt.tick(Fa)}function lc(e){let t;return Rt.tasks.size===0&&Rt.tick(Fa),{promise:new Promise(s=>{Rt.tasks.add(t={c:e,f:s})}),abort(){Rt.tasks.delete(t)}}}function to(e,t){Ss(()=>{e.dispatchEvent(new CustomEvent(t))})}function dc(e){if(e==="float")return"cssFloat";if(e==="offset")return"cssOffset";if(e.startsWith("--"))return e;const t=e.split("-");return t.length===1?t[0]:t[0]+t.slice(1).map(s=>s[0].toUpperCase()+s.slice(1)).join("")}function jr(e){const t={},s=e.split(";");for(const o of s){const[r,a]=o.split(":");if(!r||a===void 0)break;const i=dc(r.trim());t[i]=a.trim()}return t}const pc=e=>e;function so(e,t,s,o){var r=(e&hi)!==0,a=(e&mi)!==0,i=r&&a,c=(e&fi)!==0,l=i?"both":r?"in":"out",d,u=t.inert,v=t.style.overflow,h,g;function y(){return Ss(()=>d??=s()(t,o?.()??{},{direction:l}))}var x={is_global:c,in(){if(t.inert=u,!r){g?.abort(),g?.reset?.();return}a||h?.abort(),to(t,"introstart"),h=Ko(t,y(),g,1,()=>{to(t,"introend"),h?.abort(),h=d=void 0,t.style.overflow=v})},out(_){if(!a){_?.(),d=void 0;return}t.inert=!0,to(t,"outrostart"),g=Ko(t,y(),h,0,()=>{to(t,"outroend"),_?.()})},stop:()=>{h?.abort(),g?.abort()}},b=re;if((b.nodes.t??=[]).push(x),r&&Zo){var k=c;if(!k){for(var w=b.parent;w&&(w.f&qt)!==0;)for(;(w=w.parent)&&(w.f&vt)===0;);k=!w||(w.f&go)!==0}k&&U(()=>{Se(()=>x.in())})}}function Ko(e,t,s,o,r){var a=o===1;if($n(t)){var i,c=!1;return os(()=>{if(!c){var b=t({direction:a?"in":"out"});i=Ko(e,b,s,o,r)}}),{abort:()=>{c=!0,i?.abort()},deactivate:()=>i.deactivate(),reset:()=>i.reset(),t:()=>i.t()}}if(s?.deactivate(),!t?.duration)return r(),{abort:at,deactivate:at,reset:at,t:()=>o};const{delay:l=0,css:d,tick:u,easing:v=pc}=t;var h=[];if(a&&s===void 0&&(u&&u(0,1),d)){var g=jr(d(0,1));h.push(g,g)}var y=()=>1-o,x=e.animate(h,{duration:l,fill:"forwards"});return x.onfinish=()=>{x.cancel();var b=s?.t()??1-o;s?.abort();var k=o-b,w=t.duration*Math.abs(k),_=[];if(w>0){var S=!1;if(d)for(var P=Math.ceil(w/16.666666666666668),I=0;I<=P;I+=1){var T=b+k*v(I/P),A=jr(d(T,1-T));_.push(A),S||=A.overflow==="hidden"}S&&(e.style.overflow="hidden"),y=()=>{var O=x.currentTime;return b+k*v(O/w)},u&&lc(()=>{if(x.playState!=="running")return!1;var O=y();return u(O,1-O),!0})}x=e.animate(_,{duration:w,fill:"forwards"}),x.onfinish=()=>{y=()=>o,u?.(o,1-o),r()}},{abort:()=>{x&&(x.cancel(),x.effect=null,x.onfinish=at)},deactivate:()=>{r=at},reset:()=>{o===0&&u?.(1,0)},t:()=>y()}}function G(e,t){var s;s=document.head.appendChild(St());try{Ts(()=>t(s),cr)}finally{}}const Ur=[...` 	
\r\f \v\uFEFF`];function uc(e,t,s){var o=e==null?"":""+e;if(s){for(var r in s)if(s[r])o=o?o+" "+r:r;else if(o.length)for(var a=r.length,i=0;(i=o.indexOf(r,i))>=0;){var c=i+a;(i===0||Ur.includes(o[i-1]))&&(c===o.length||Ur.includes(o[c]))?o=(i===0?"":o.substring(0,i))+o.substring(c+1):i=c}}return o===""?null:o}function hc(e,t){return e==null?null:String(e)}function kt(e,t,s,o,r,a){var i=e.__className;if(i!==s||i===void 0){var c=uc(s,o,a);c==null?e.removeAttribute("class"):e.className=c,e.__className=s}else if(a&&r!==a)for(var l in a){var d=!!a[l];(r==null||d!==!!r[l])&&e.classList.toggle(l,d)}return a}function $t(e,t,s,o){var r=e.__style;if(r!==t){var a=hc(t);a==null?e.removeAttribute("style"):e.style.cssText=a,e.__style=t}return o}const mc=Symbol("is custom element"),fc=Symbol("is html");function ks(e,t,s,o){var r=vc(e);r[t]!==(r[t]=s)&&(t==="loading"&&(e[Zn]=s),s==null?e.removeAttribute(t):typeof s!="string"&&gc(e).includes(t)?e[t]=s:e.setAttribute(t,s))}function vc(e){return e.__attributes??={[mc]:e.nodeName.includes("-"),[fc]:e.namespaceURI===gi}}var Fr=new Map;function gc(e){var t=e.getAttribute("is")||e.nodeName,s=Fr.get(t);if(s)return s;Fr.set(t,s=[]);for(var o,r=e,a=Element.prototype;a!==r;){o=na(r);for(var i in o)o[i].set&&s.push(i);r=nr(r)}return s}function bc(e,t,s=t){var o=new WeakSet;Oi(e,"input",async r=>{var a=r?e.defaultValue:e.value;if(a=zo(e)?Po(a):a,s(a),ne!==null&&o.add(ne),await Gi(),a!==(a=t())){var i=e.selectionStart,c=e.selectionEnd,l=e.value.length;if(e.value=a??"",c!==null){var d=e.value.length;i===c&&c===l&&d>l?(e.selectionStart=d,e.selectionEnd=d):(e.selectionStart=i,e.selectionEnd=Math.min(c,d))}}}),Se(t)==null&&e.value&&(s(zo(e)?Po(e.value):e.value),ne!==null&&o.add(ne)),Gs(()=>{var r=t();if(e===document.activeElement){var a=ao??ne;if(o.has(a))return}zo(e)&&r===Po(e.value)||e.type==="date"&&!r&&!e.value||r!==e.value&&(e.value=r??"")})}function zo(e){var t=e.type;return t==="number"||t==="range"}function Po(e){return e===""?null:+e}function $r(e,t){return e===t||e?.[Vt]===t}function yc(e={},t,s,o){return U(()=>{var r,a;return Gs(()=>{r=a,a=[],Se(()=>{e!==s(...a)&&(t(e,...a),r&&$r(s(...r),e)&&t(null,...r))})}),()=>{os(()=>{a&&$r(s(...a),e)&&t(null,...a)})}}),e}function xc(e){return function(...t){var s=t[0];return s.stopPropagation(),e?.apply(this,t)}}function wc(e){return function(...t){var s=t[0];return s.preventDefault(),e?.apply(this,t)}}function we(e=!1){const t=ue,s=t.l.u;if(!s)return;let o=()=>Ua(t.s);if(e){let r=0,a={};const i=dr(()=>{let c=!1;const l=t.s;for(const d in l)l[d]!==a[d]&&(a[d]=l[d],c=!0);return c&&r++,r});o=()=>C(i)}s.b.length&&Li(()=>{Gr(t,o),Bo(s.b)}),Go(()=>{const r=Se(()=>s.m.map(Gn));return()=>{for(const a of r)typeof a=="function"&&a()}}),s.a.length&&Go(()=>{Gr(t,o),Bo(s.a)})}function Gr(e,t){if(e.l.s)for(const s of e.l.s)C(s);t()}function kc(e,t){var s=e.$$events?.[t.type],o=ar(s)?s.slice():s==null?[]:[s];for(var r of o)r.call(this,t)}function $a(e,t,s){if(e==null)return t(void 0),at;const o=Se(()=>e.subscribe(t,s));return o.unsubscribe?()=>o.unsubscribe():o}const us=[];function Js(e,t=at){let s=null;const o=new Set;function r(c){if(ua(e,c)&&(e=c,s)){const l=!us.length;for(const d of o)d[1](),us.push(d,e);if(l){for(let d=0;d<us.length;d+=2)us[d][0](us[d+1]);us.length=0}}}function a(c){r(c(e))}function i(c,l=at){const d=[c,l];return o.add(d),o.size===1&&(s=t(r,a)||at),c(e),()=>{o.delete(d),o.size===0&&s&&(s(),s=null)}}return{set:r,update:a,subscribe:i}}function Rc(e){let t;return $a(e,s=>t=s)(),t}let oo=!1,Xo=Symbol();function Fs(e,t,s){const o=s[t]??={store:null,source:Ke(void 0),unsubscribe:at};if(o.store!==e&&!(Xo in s))if(o.unsubscribe(),o.store=e??null,e==null)o.source.v=void 0,o.unsubscribe=at;else{var r=!0;o.unsubscribe=$a(e,a=>{r?o.source.v=a:de(o.source,a)}),r=!1}return e&&Xo in s?Rc(e):C(o.source)}function _c(e,t){return e.set(t),t}function yo(){const e={};function t(){hr(()=>{for(var s in e)e[s].unsubscribe();aa(e,Xo,{enumerable:!1,value:!0})})}return[e,t]}function Cc(e){var t=oo;try{return oo=!1,[e(),oo]}finally{oo=t}}function Zt(e,t,s,o){var r=!_s||(s&di)!==0,a=(s&ui)!==0,i=o,c=!0,l=()=>(c&&(c=!1,i=o),i),d;{var u=Vt in e||Wn in e;d=vs(e,t)?.set??(u&&t in e?w=>e[t]=w:void 0)}var v,h=!1;[v,h]=Cc(()=>e[t]),v===void 0&&o!==void 0&&(v=l(),d&&(r&&ti(),d(v)));var g;if(r?g=()=>{var w=e[t];return w===void 0?l():(c=!0,w)}:g=()=>{var w=e[t];return w!==void 0&&(i=void 0),w===void 0?i:w},r&&(s&pi)===0)return g;if(d){var y=e.$$legacy;return(function(w,_){return arguments.length>0?((!r||!_||y||h)&&d(_?g():w),w):g()})}var x=!1,b=pr(()=>(x=!1,g()));C(b);var k=re;return(function(w,_){if(arguments.length>0){const S=_?C(b):r&&a?fs(w):w;return de(b,S),x=!0,i!==void 0&&(i=S),w}return rs&&x||(k.f&Ct)!==0?b.v:C(b)})}function xo(e){ue===null&&Vn(),_s&&ue.l!==null?Sc(ue).m.push(e):Go(()=>{const t=Se(e);if(typeof t=="function")return t})}function Sc(e){var t=e.l;return t.u??={a:[],b:[],m:[]}}const Tc="5";typeof window<"u"&&((window.__svelte??={}).v??=new Set).add(Tc);xi();function Ac(){const e=()=>{if(typeof window>"u")return"/";const o=window.location.hash;return!o||o==="#"||o==="#/"?"/":o.startsWith("#/")?o.slice(1):o.slice(1)||"/"},{subscribe:t,set:s}=Js(e());return typeof window<"u"&&(window.addEventListener("hashchange",()=>{s(e())}),window.addEventListener("load",()=>{s(e())})),{subscribe:t,navigate:o=>{if(typeof window<"u"){const r=o.startsWith("/")?o:"/"+o;window.location.hash="#"+r,s(r),window.scrollTo({top:0,behavior:"smooth"})}}}}const Ga=Ac();function be(e){Ga.navigate(e)}function Ec(){const e=typeof window<"u"?localStorage.getItem("theme"):null,t=typeof window<"u"&&window.matchMedia("(prefers-color-scheme: dark)").matches,s=e||(t?"dark":"light"),{subscribe:o,set:r,update:a}=Js(s);return{subscribe:o,toggle:()=>{a(i=>{const c=i==="light"?"dark":"light";return typeof window<"u"&&(localStorage.setItem("theme",c),document.documentElement.classList.toggle("dark",c==="dark")),c})},set:i=>{typeof window<"u"&&(localStorage.setItem("theme",i),document.documentElement.classList.toggle("dark",i==="dark")),r(i)},init:()=>{if(typeof window<"u"){const i=localStorage.getItem("theme"),c=window.matchMedia("(prefers-color-scheme: dark)").matches,l=i||(c?"dark":"light");document.documentElement.classList.toggle("dark",l==="dark"),r(l)}}}}const Qo=Ec(),Os=Js(!1),Bs=Js(!1),No=Js(""),Ic="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0MDAgMTIwIiB3aWR0aD0iNDAwIiBoZWlnaHQ9IjEyMCI+CiAgPGRlZnM+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImxpZ2h0bmluZy1ncmFkaWVudC1kYXJrIiB4MT0iMCUiIHkxPSIwJSIgeDI9IjEwMCUiIHkyPSIxMDAlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgc3R5bGU9InN0b3AtY29sb3I6IzAwRDRGRjtzdG9wLW9wYWNpdHk6MSIgLz4KICAgICAgPHN0b3Agb2Zmc2V0PSI1MCUiIHN0eWxlPSJzdG9wLWNvbG9yOiMwMDk5RkY7c3RvcC1vcGFjaXR5OjEiIC8+CiAgICAgIDxzdG9wIG9mZnNldD0iMTAwJSIgc3R5bGU9InN0b3AtY29sb3I6IzAwNjZDQztzdG9wLW9wYWNpdHk6MSIgLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgICA8ZmlsdGVyIGlkPSJnbG93LWRhcmsiIHg9Ii01MCUiIHk9Ii01MCUiIHdpZHRoPSIyMDAlIiBoZWlnaHQ9IjIwMCUiPgogICAgICA8ZmVHYXVzc2lhbkJsdXIgc3RkRGV2aWF0aW9uPSIzIiByZXN1bHQ9ImNvbG9yZWRCbHVyIi8+CiAgICAgIDxmZU1lcmdlPgogICAgICAgIDxmZU1lcmdlTm9kZSBpbj0iY29sb3JlZEJsdXIiLz4KICAgICAgICA8ZmVNZXJnZU5vZGUgaW49IlNvdXJjZUdyYXBoaWMiLz4KICAgICAgPC9mZU1lcmdlPgogICAgPC9maWx0ZXI+CiAgPC9kZWZzPgogIAogIDxnIHRyYW5zZm9ybT0idHJhbnNsYXRlKDIwLCAxNSkiPgogICAgPGNpcmNsZSBjeD0iNDUiIGN5PSI0NSIgcj0iNDAiIGZpbGw9Im5vbmUiIHN0cm9rZT0idXJsKCNsaWdodG5pbmctZ3JhZGllbnQtZGFyaykiIHN0cm9rZS13aWR0aD0iMyIgb3BhY2l0eT0iMC4zIi8+CiAgICA8Y2lyY2xlIGN4PSI0NSIgY3k9IjQ1IiByPSIzMiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJ1cmwoI2xpZ2h0bmluZy1ncmFkaWVudC1kYXJrKSIgc3Ryb2tlLXdpZHRoPSIyIiBvcGFjaXR5PSIwLjUiLz4KICAgIAogICAgPGcgZmlsdGVyPSJ1cmwoI2dsb3ctZGFyaykiPgogICAgICA8cGF0aCBkPSJNNTUgMTUgTDM1IDUwIEw1MCA1MCBMMzAgODAgTDY1IDQyIEw0OCA0MiBMNjUgMTUgWiIgCiAgICAgICAgICAgIGZpbGw9InVybCgjbGlnaHRuaW5nLWdyYWRpZW50LWRhcmspIiAKICAgICAgICAgICAgc3Ryb2tlPSIjRkZGRkZGIiAKICAgICAgICAgICAgc3Ryb2tlLXdpZHRoPSIxLjUiCiAgICAgICAgICAgIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz4KICAgIDwvZz4KICAgIAogICAgPGNpcmNsZSBjeD0iNDUiIGN5PSI0NSIgcj0iNDQiIGZpbGw9Im5vbmUiIHN0cm9rZT0idXJsKCNsaWdodG5pbmctZ3JhZGllbnQtZGFyaykiIHN0cm9rZS13aWR0aD0iMSIgc3Ryb2tlLWRhc2hhcnJheT0iNCA2IiBvcGFjaXR5PSIwLjQiPgogICAgICA8YW5pbWF0ZVRyYW5zZm9ybSBhdHRyaWJ1dGVOYW1lPSJ0cmFuc2Zvcm0iIHR5cGU9InJvdGF0ZSIgZnJvbT0iMCA0NSA0NSIgdG89IjM2MCA0NSA0NSIgZHVyPSIyMHMiIHJlcGVhdENvdW50PSJpbmRlZmluaXRlIi8+CiAgICA8L2NpcmNsZT4KICA8L2c+CiAgCiAgPHRleHQgeD0iMTE1IiB5PSI3MiIgZm9udC1mYW1pbHk9IidTZWdvZSBVSScsICdTRiBQcm8gRGlzcGxheScsIC1hcHBsZS1zeXN0ZW0sIEJsaW5rTWFjU3lzdGVtRm9udCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSI1NiIgZm9udC13ZWlnaHQ9IjcwMCIgZmlsbD0iIzFhMWEyZSIgbGV0dGVyLXNwYWNpbmc9Ii0xIj4KICAgIFJFWk8KICA8L3RleHQ+CiAgCiAgPHRleHQgeD0iMjcwIiB5PSI3MiIgZm9udC1mYW1pbHk9IidTZWdvZSBVSScsICdTRiBQcm8gRGlzcGxheScsIC1hcHBsZS1zeXN0ZW0sIEJsaW5rTWFjU3lzdGVtRm9udCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIxNCIgZm9udC13ZWlnaHQ9IjQwMCIgZmlsbD0iIzAwNjZDQyIgb3BhY2l0eT0iMC45IiBsZXR0ZXItc3BhY2luZz0iMiI+CiAgICBIVFRQCiAgPC90ZXh0PgogIAogIDxsaW5lIHgxPSIxMTUiIHkxPSI4NSIgeDI9IjMyMCIgeTI9Ijg1IiBzdHJva2U9InVybCgjbGlnaHRuaW5nLWdyYWRpZW50LWRhcmspIiBzdHJva2Utd2lkdGg9IjIiIG9wYWNpdHk9IjAuNiIvPgogIAogIDx0ZXh0IHg9IjExNSIgeT0iMTAyIiBmb250LWZhbWlseT0iJ1NlZ29lIFVJJywgJ1NGIFBybyBEaXNwbGF5JywgLWFwcGxlLXN5c3RlbSwgQmxpbmtNYWNTeXN0ZW1Gb250LCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjExIiBmb250LXdlaWdodD0iNDAwIiBmaWxsPSIjNTU1NTU1IiBsZXR0ZXItc3BhY2luZz0iMyI+CiAgICBMSUdIVE5JTkcgRkFTVCBIVFRQIENMSUVOVAogIDwvdGV4dD4KPC9zdmc+Cg==",zc="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0MDAgMTIwIiB3aWR0aD0iNDAwIiBoZWlnaHQ9IjEyMCI+CiAgPGRlZnM+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImxpZ2h0bmluZy1ncmFkaWVudCIgeDE9IjAlIiB5MT0iMCUiIHgyPSIxMDAlIiB5Mj0iMTAwJSI+CiAgICAgIDxzdG9wIG9mZnNldD0iMCUiIHN0eWxlPSJzdG9wLWNvbG9yOiMwMEQ0RkY7c3RvcC1vcGFjaXR5OjEiIC8+CiAgICAgIDxzdG9wIG9mZnNldD0iNTAlIiBzdHlsZT0ic3RvcC1jb2xvcjojMDA5OUZGO3N0b3Atb3BhY2l0eToxIiAvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0eWxlPSJzdG9wLWNvbG9yOiMwMDY2Q0M7c3RvcC1vcGFjaXR5OjEiIC8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogICAgPGxpbmVhckdyYWRpZW50IGlkPSJ0ZXh0LWdyYWRpZW50IiB4MT0iMCUiIHkxPSIwJSIgeDI9IjEwMCUiIHkyPSIwJSI+CiAgICAgIDxzdG9wIG9mZnNldD0iMCUiIHN0eWxlPSJzdG9wLWNvbG9yOiNGRkZGRkY7c3RvcC1vcGFjaXR5OjEiIC8+CiAgICAgIDxzdG9wIG9mZnNldD0iMTAwJSIgc3R5bGU9InN0b3AtY29sb3I6I0UwRTBFMDtzdG9wLW9wYWNpdHk6MSIgLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgICA8ZmlsdGVyIGlkPSJnbG93IiB4PSItNTAlIiB5PSItNTAlIiB3aWR0aD0iMjAwJSIgaGVpZ2h0PSIyMDAlIj4KICAgICAgPGZlR2F1c3NpYW5CbHVyIHN0ZERldmlhdGlvbj0iMyIgcmVzdWx0PSJjb2xvcmVkQmx1ciIvPgogICAgICA8ZmVNZXJnZT4KICAgICAgICA8ZmVNZXJnZU5vZGUgaW49ImNvbG9yZWRCbHVyIi8+CiAgICAgICAgPGZlTWVyZ2VOb2RlIGluPSJTb3VyY2VHcmFwaGljIi8+CiAgICAgIDwvZmVNZXJnZT4KICAgIDwvZmlsdGVyPgogICAgPGZpbHRlciBpZD0ic2hhZG93IiB4PSItMjAlIiB5PSItMjAlIiB3aWR0aD0iMTQwJSIgaGVpZ2h0PSIxNDAlIj4KICAgICAgPGZlRHJvcFNoYWRvdyBkeD0iMCIgZHk9IjIiIHN0ZERldmlhdGlvbj0iMyIgZmxvb2QtY29sb3I9IiMwMDAwMDAiIGZsb29kLW9wYWNpdHk9IjAuMyIvPgogICAgPC9maWx0ZXI+CiAgPC9kZWZzPgogIAogIDxyZWN0IHdpZHRoPSI0MDAiIGhlaWdodD0iMTIwIiBmaWxsPSIjMGEwYTBmIiByeD0iOCIvPgogIAogIDxnIHRyYW5zZm9ybT0idHJhbnNsYXRlKDIwLCAxNSkiPgogICAgPGNpcmNsZSBjeD0iNDUiIGN5PSI0NSIgcj0iNDAiIGZpbGw9Im5vbmUiIHN0cm9rZT0idXJsKCNsaWdodG5pbmctZ3JhZGllbnQpIiBzdHJva2Utd2lkdGg9IjMiIG9wYWNpdHk9IjAuMyIvPgogICAgPGNpcmNsZSBjeD0iNDUiIGN5PSI0NSIgcj0iMzIiIGZpbGw9Im5vbmUiIHN0cm9rZT0idXJsKCNsaWdodG5pbmctZ3JhZGllbnQpIiBzdHJva2Utd2lkdGg9IjIiIG9wYWNpdHk9IjAuNSIvPgogICAgCiAgICA8ZyBmaWx0ZXI9InVybCgjZ2xvdykiPgogICAgICA8cGF0aCBkPSJNNTUgMTUgTDM1IDUwIEw1MCA1MCBMMzAgODAgTDY1IDQyIEw0OCA0MiBMNjUgMTUgWiIgCiAgICAgICAgICAgIGZpbGw9InVybCgjbGlnaHRuaW5nLWdyYWRpZW50KSIgCiAgICAgICAgICAgIHN0cm9rZT0iI0ZGRkZGRiIgCiAgICAgICAgICAgIHN0cm9rZS13aWR0aD0iMS41IgogICAgICAgICAgICBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+CiAgICA8L2c+CiAgICAKICAgIDxjaXJjbGUgY3g9IjQ1IiBjeT0iNDUiIHI9IjQ0IiBmaWxsPSJub25lIiBzdHJva2U9InVybCgjbGlnaHRuaW5nLWdyYWRpZW50KSIgc3Ryb2tlLXdpZHRoPSIxIiBzdHJva2UtZGFzaGFycmF5PSI0IDYiIG9wYWNpdHk9IjAuNCI+CiAgICAgIDxhbmltYXRlVHJhbnNmb3JtIGF0dHJpYnV0ZU5hbWU9InRyYW5zZm9ybSIgdHlwZT0icm90YXRlIiBmcm9tPSIwIDQ1IDQ1IiB0bz0iMzYwIDQ1IDQ1IiBkdXI9IjIwcyIgcmVwZWF0Q291bnQ9ImluZGVmaW5pdGUiLz4KICAgIDwvY2lyY2xlPgogIDwvZz4KICAKICA8ZyBmaWx0ZXI9InVybCgjc2hhZG93KSI+CiAgICA8dGV4dCB4PSIxMTUiIHk9IjcyIiBmb250LWZhbWlseT0iJ1NlZ29lIFVJJywgJ1NGIFBybyBEaXNwbGF5JywgLWFwcGxlLXN5c3RlbSwgQmxpbmtNYWNTeXN0ZW1Gb250LCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjU2IiBmb250LXdlaWdodD0iNzAwIiBmaWxsPSJ1cmwoI3RleHQtZ3JhZGllbnQpIiBsZXR0ZXItc3BhY2luZz0iLTEiPgogICAgICBSRVpPCiAgICA8L3RleHQ+CiAgPC9nPgogIAogIDx0ZXh0IHg9IjI3MCIgeT0iNzIiIGZvbnQtZmFtaWx5PSInU2Vnb2UgVUknLCAnU0YgUHJvIERpc3BsYXknLCAtYXBwbGUtc3lzdGVtLCBCbGlua01hY1N5c3RlbUZvbnQsIHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQiIGZvbnQtd2VpZ2h0PSI0MDAiIGZpbGw9IiMwMEQ0RkYiIG9wYWNpdHk9IjAuOSIgbGV0dGVyLXNwYWNpbmc9IjIiPgogICAgSFRUUAogIDwvdGV4dD4KICAKICA8bGluZSB4MT0iMTE1IiB5MT0iODUiIHgyPSIzMjAiIHkyPSI4NSIgc3Ryb2tlPSJ1cmwoI2xpZ2h0bmluZy1ncmFkaWVudCkiIHN0cm9rZS13aWR0aD0iMiIgb3BhY2l0eT0iMC42Ii8+CiAgCiAgPHRleHQgeD0iMTE1IiB5PSIxMDIiIGZvbnQtZmFtaWx5PSInU2Vnb2UgVUknLCAnU0YgUHJvIERpc3BsYXknLCAtYXBwbGUtc3lzdGVtLCBCbGlua01hY1N5c3RlbUZvbnQsIHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTEiIGZvbnQtd2VpZ2h0PSI0MDAiIGZpbGw9IiM4ODg4ODgiIGxldHRlci1zcGFjaW5nPSIzIj4KICAgIExJR0hUTklORyBGQVNUIEhUVFAgQ0xJRU5UCiAgPC90ZXh0Pgo8L3N2Zz4K";var Pc=N('<button class="lg:hidden p-2 rounded-lg hover:bg-[var(--surface)] transition-colors cursor-pointer" aria-label="Toggle menu"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color: var(--text);"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path></svg></button>'),Nc=N('<img alt="Rezo" class="h-8"/>'),Mc=N('<img alt="Rezo" class="h-8"/>'),Dc=as('<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color: var(--text);"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>'),Oc=as('<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color: var(--text);"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path></svg>'),Hc=N('<header class="fixed top-0 left-0 right-0 z-50 h-16 border-b transition-colors duration-300" style="background-color: var(--bg); border-color: var(--border);"><div class="flex items-center justify-between h-full px-4 lg:px-6 max-w-[1600px] mx-auto"><div class="flex items-center gap-4"><!> <a href="#/" class="flex items-center cursor-pointer"><!></a></div> <div class="flex items-center gap-2 sm:gap-4"><button class="lg:hidden p-2 rounded-lg hover:bg-[var(--surface)] transition-colors cursor-pointer" aria-label="Search"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color: var(--text);"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg></button> <button class="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors text-sm cursor-pointer" style="background-color: var(--surface); border-color: var(--border); color: var(--muted);"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg> <span>Search...</span> <kbd class="hidden md:inline px-1.5 py-0.5 text-xs rounded" style="background-color: var(--border);">Ctrl+K</kbd></button> <a href="https://github.com/user/rezo" target="_blank" rel="noopener" class="p-2 rounded-lg hover:bg-[var(--surface)] transition-colors cursor-pointer" aria-label="GitHub"><svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" style="color: var(--text);"><path fill-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clip-rule="evenodd"></path></svg></a> <a href="https://npmjs.com/package/rezo" target="_blank" rel="noopener" class="p-2 rounded-lg hover:bg-[var(--surface)] transition-colors cursor-pointer" aria-label="npm"><svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" style="color: var(--text);"><path d="M0 7.334v8h6.666v1.332H12v-1.332h12v-8H0zm6.666 6.664H5.334v-4H3.999v4H1.335V8.667h5.331v5.331zm4 0v1.336H8.001V8.667h5.334v5.332h-2.669v-.001zm12.001 0h-1.33v-4h-1.336v4h-1.335v-4h-1.33v4h-2.671V8.667h8.002v5.331z"></path></svg></a> <button class="p-2 rounded-lg hover:bg-[var(--surface)] transition-colors cursor-pointer" aria-label="Toggle theme"><!></button></div></div></header>');function Ja(e,t){he(t,!1);const s=()=>Fs(Qo,"$theme",o),[o,r]=yo();let a=Zt(t,"isLanding",8,!1);function i(T){(T.metaKey||T.ctrlKey)&&T.key==="k"&&(T.preventDefault(),Bs.set(!0))}we();var c=Hc();ee("keydown",$o,i);var l=p(c),d=p(l),u=p(d);{var v=T=>{var A=Pc();ee("click",A,()=>Os.update(O=>!O)),E(T,A)};Ze(u,T=>{a()||T(v)})}var h=n(u,2),g=p(h);{var y=T=>{var A=Nc();pe(()=>ks(A,"src",zc)),E(T,A)},x=T=>{var A=Mc();pe(()=>ks(A,"src",Ic)),E(T,A)};Ze(g,T=>{s()==="dark"?T(y):T(x,!1)})}var b=n(d,2),k=p(b),w=n(k,2),_=n(w,6),S=p(_);{var P=T=>{var A=Dc();E(T,A)},I=T=>{var A=Oc();E(T,A)};Ze(S,T=>{s()==="dark"?T(P):T(I,!1)})}ee("click",k,()=>Bs.set(!0)),ee("click",w,()=>Bs.set(!0)),ee("click",_,()=>Qo.toggle()),E(e,c),me(),r()}var Lc=N('<div class="fixed inset-0 bg-black/50 z-40 lg:hidden" role="button" tabindex="0" aria-label="Close sidebar"></div>'),qc=N("<li><a> </a></li>"),Bc=N('<div class="mb-6"><h3 class="px-3 mb-2 text-xs font-semibold uppercase tracking-wider" style="color: var(--muted);"> </h3> <ul class="space-y-1"></ul></div>'),jc=N('<!> <aside style="background-color: var(--bg); border-color: var(--border);"><nav class="p-4 pb-20"></nav></aside>',1);function Uc(e,t){he(t,!1);const s=()=>Fs(Os,"$sidebarOpen",o),[o,r]=yo();let a=Zt(t,"currentPath",8,"/");const i=[{title:"Getting Started",items:[{name:"Introduction",path:"/docs"},{name:"Installation",path:"/installation"},{name:"Quick Start",path:"/quick-start"},{name:"Why Rezo?",path:"/why-rezo"}]},{title:"Core HTTP",items:[{name:"Making Requests",path:"/requests"},{name:"Response Handling",path:"/responses"},{name:"Configuration",path:"/configuration"},{name:"Error Handling",path:"/errors"}]},{title:"Advanced",items:[{name:"Cookies & Sessions",path:"/advanced/cookies"},{name:"Hooks System",path:"/advanced/hooks"},{name:"Retry & Resilience",path:"/advanced/retry"},{name:"Caching",path:"/advanced/caching"},{name:"Proxy Configuration",path:"/advanced/proxy"},{name:"ProxyManager",path:"/advanced/proxy-manager"},{name:"Queue & Rate Limiting",path:"/advanced/queue"},{name:"Streaming",path:"/advanced/streaming"},{name:"TLS & Security",path:"/advanced/security"}]},{title:"Adapters",items:[{name:"Overview",path:"/adapters"},{name:"HTTP Adapter",path:"/adapters/http"},{name:"HTTP/2 Adapter",path:"/adapters/http2"},{name:"Fetch Adapter",path:"/adapters/fetch"},{name:"cURL Adapter",path:"/adapters/curl"},{name:"XHR Adapter",path:"/adapters/xhr"},{name:"React Native",path:"/adapters/react-native"}]},{title:"Utilities",items:[{name:"RezoHeaders",path:"/utilities/headers"},{name:"RezoFormData",path:"/utilities/formdata"},{name:"RezoCookieJar",path:"/utilities/cookiejar"},{name:"DOM Module",path:"/utilities/dom"}]},{title:"Crawler",items:[{name:"Getting Started",path:"/crawler"},{name:"Configuration",path:"/crawler/configuration"},{name:"Event Handlers",path:"/crawler/events"},{name:"Proxy Integration",path:"/crawler/proxy"},{name:"Caching & Limits",path:"/crawler/caching"}]},{title:"API Reference",items:[{name:"Rezo Instance",path:"/api/instance"},{name:"Request Options",path:"/api/options"},{name:"Response Object",path:"/api/response"},{name:"RezoError",path:"/api/error"},{name:"Types",path:"/api/types"}]},{title:"Migration",items:[{name:"From Axios",path:"/migration/axios"},{name:"From Got",path:"/migration/got"},{name:"From node-fetch",path:"/migration/node-fetch"}]},{title:"Resources",items:[{name:"Examples",path:"/examples"},{name:"FAQ",path:"/faq"},{name:"Changelog",path:"/changelog"},{name:"Contributing",path:"/contributing"}]}];function c(x){return a()===x}function l(x,b){x.preventDefault(),be(b),Os.set(!1)}we();var d=jc(),u=io(d);{var v=x=>{var b=Lc();ee("click",b,()=>Os.set(!1)),ee("keydown",b,k=>k.key==="Escape"&&Os.set(!1)),E(x,b)};Ze(u,x=>{s()&&x(v)})}var h=n(u,2);let g;var y=p(h);ze(y,5,()=>i,Ie,(x,b)=>{var k=Bc(),w=p(k),_=p(w),S=n(w,2);ze(S,5,()=>(C(b),Se(()=>C(b).items)),Ie,(P,I)=>{var T=qc(),A=p(T);let O;var Z=p(A);pe(K=>{ks(A,"href",(C(I),Se(()=>"#"+C(I).path))),O=kt(A,1,"sidebar-link block text-sm w-full text-left cursor-pointer",null,O,K),Q(Z,(C(I),Se(()=>C(I).name)))},[()=>({active:c(C(I).path)})]),ee("click",A,K=>l(K,C(I).path)),E(P,T)}),pe(()=>Q(_,(C(b),Se(()=>C(b).title)))),E(x,k)}),pe(()=>g=kt(h,1,"fixed top-16 left-0 bottom-0 w-72 overflow-y-auto z-40 transition-transform duration-300 border-r lg:translate-x-0",null,g,{"translate-x-0":s(),"-translate-x-full":!s()})),E(e,d),me(),r()}function At(e){return Array.isArray?Array.isArray(e):Va(e)==="[object Array]"}function Fc(e){if(typeof e=="string")return e;let t=e+"";return t=="0"&&1/e==-1/0?"-0":t}function $c(e){return e==null?"":Fc(e)}function mt(e){return typeof e=="string"}function Wa(e){return typeof e=="number"}function Gc(e){return e===!0||e===!1||Jc(e)&&Va(e)=="[object Boolean]"}function Za(e){return typeof e=="object"}function Jc(e){return Za(e)&&e!==null}function Je(e){return e!=null}function Mo(e){return!e.trim().length}function Va(e){return e==null?e===void 0?"[object Undefined]":"[object Null]":Object.prototype.toString.call(e)}const Wc="Incorrect 'index' type",Zc=e=>`Invalid value for key ${e}`,Vc=e=>`Pattern length exceeds max of ${e}.`,Kc=e=>`Missing ${e} property in key`,Xc=e=>`Property 'weight' in key '${e}' must be a positive integer`,Jr=Object.prototype.hasOwnProperty;class Qc{constructor(t){this._keys=[],this._keyMap={};let s=0;t.forEach(o=>{let r=Ka(o);this._keys.push(r),this._keyMap[r.id]=r,s+=r.weight}),this._keys.forEach(o=>{o.weight/=s})}get(t){return this._keyMap[t]}keys(){return this._keys}toJSON(){return JSON.stringify(this._keys)}}function Ka(e){let t=null,s=null,o=null,r=1,a=null;if(mt(e)||At(e))o=e,t=Wr(e),s=Yo(e);else{if(!Jr.call(e,"name"))throw new Error(Kc("name"));const i=e.name;if(o=i,Jr.call(e,"weight")&&(r=e.weight,r<=0))throw new Error(Xc(i));t=Wr(i),s=Yo(i),a=e.getFn}return{path:t,id:s,weight:r,src:o,getFn:a}}function Wr(e){return At(e)?e:e.split(".")}function Yo(e){return At(e)?e.join("."):e}function Yc(e,t){let s=[],o=!1;const r=(a,i,c)=>{if(Je(a))if(!i[c])s.push(a);else{let l=i[c];const d=a[l];if(!Je(d))return;if(c===i.length-1&&(mt(d)||Wa(d)||Gc(d)))s.push($c(d));else if(At(d)){o=!0;for(let u=0,v=d.length;u<v;u+=1)r(d[u],i,c+1)}else i.length&&r(d,i,c+1)}};return r(e,mt(t)?t.split("."):t,0),o?s:s[0]}const el={includeMatches:!1,findAllMatches:!1,minMatchCharLength:1},tl={isCaseSensitive:!1,ignoreDiacritics:!1,includeScore:!1,keys:[],shouldSort:!0,sortFn:(e,t)=>e.score===t.score?e.idx<t.idx?-1:1:e.score<t.score?-1:1},sl={location:0,threshold:.6,distance:100},ol={useExtendedSearch:!1,getFn:Yc,ignoreLocation:!1,ignoreFieldNorm:!1,fieldNormWeight:1};var j={...tl,...el,...sl,...ol};const rl=/[^ ]+/g;function al(e=1,t=3){const s=new Map,o=Math.pow(10,t);return{get(r){const a=r.match(rl).length;if(s.has(a))return s.get(a);const i=1/Math.pow(a,.5*e),c=parseFloat(Math.round(i*o)/o);return s.set(a,c),c},clear(){s.clear()}}}class br{constructor({getFn:t=j.getFn,fieldNormWeight:s=j.fieldNormWeight}={}){this.norm=al(s,3),this.getFn=t,this.isCreated=!1,this.setIndexRecords()}setSources(t=[]){this.docs=t}setIndexRecords(t=[]){this.records=t}setKeys(t=[]){this.keys=t,this._keysMap={},t.forEach((s,o)=>{this._keysMap[s.id]=o})}create(){this.isCreated||!this.docs.length||(this.isCreated=!0,mt(this.docs[0])?this.docs.forEach((t,s)=>{this._addString(t,s)}):this.docs.forEach((t,s)=>{this._addObject(t,s)}),this.norm.clear())}add(t){const s=this.size();mt(t)?this._addString(t,s):this._addObject(t,s)}removeAt(t){this.records.splice(t,1);for(let s=t,o=this.size();s<o;s+=1)this.records[s].i-=1}getValueForItemAtKeyId(t,s){return t[this._keysMap[s]]}size(){return this.records.length}_addString(t,s){if(!Je(t)||Mo(t))return;let o={v:t,i:s,n:this.norm.get(t)};this.records.push(o)}_addObject(t,s){let o={i:s,$:{}};this.keys.forEach((r,a)=>{let i=r.getFn?r.getFn(t):this.getFn(t,r.path);if(Je(i)){if(At(i)){let c=[];const l=[{nestedArrIndex:-1,value:i}];for(;l.length;){const{nestedArrIndex:d,value:u}=l.pop();if(Je(u))if(mt(u)&&!Mo(u)){let v={v:u,i:d,n:this.norm.get(u)};c.push(v)}else At(u)&&u.forEach((v,h)=>{l.push({nestedArrIndex:h,value:v})})}o.$[a]=c}else if(mt(i)&&!Mo(i)){let c={v:i,n:this.norm.get(i)};o.$[a]=c}}}),this.records.push(o)}toJSON(){return{keys:this.keys,records:this.records}}}function Xa(e,t,{getFn:s=j.getFn,fieldNormWeight:o=j.fieldNormWeight}={}){const r=new br({getFn:s,fieldNormWeight:o});return r.setKeys(e.map(Ka)),r.setSources(t),r.create(),r}function nl(e,{getFn:t=j.getFn,fieldNormWeight:s=j.fieldNormWeight}={}){const{keys:o,records:r}=e,a=new br({getFn:t,fieldNormWeight:s});return a.setKeys(o),a.setIndexRecords(r),a}function ro(e,{errors:t=0,currentLocation:s=0,expectedLocation:o=0,distance:r=j.distance,ignoreLocation:a=j.ignoreLocation}={}){const i=t/e.length;if(a)return i;const c=Math.abs(o-s);return r?i+c/r:c?1:i}function il(e=[],t=j.minMatchCharLength){let s=[],o=-1,r=-1,a=0;for(let i=e.length;a<i;a+=1){let c=e[a];c&&o===-1?o=a:!c&&o!==-1&&(r=a-1,r-o+1>=t&&s.push([o,r]),o=-1)}return e[a-1]&&a-o>=t&&s.push([o,a-1]),s}const Jt=32;function cl(e,t,s,{location:o=j.location,distance:r=j.distance,threshold:a=j.threshold,findAllMatches:i=j.findAllMatches,minMatchCharLength:c=j.minMatchCharLength,includeMatches:l=j.includeMatches,ignoreLocation:d=j.ignoreLocation}={}){if(t.length>Jt)throw new Error(Vc(Jt));const u=t.length,v=e.length,h=Math.max(0,Math.min(o,v));let g=a,y=h;const x=c>1||l,b=x?Array(v):[];let k;for(;(k=e.indexOf(t,y))>-1;){let T=ro(t,{currentLocation:k,expectedLocation:h,distance:r,ignoreLocation:d});if(g=Math.min(T,g),y=k+u,x){let A=0;for(;A<u;)b[k+A]=1,A+=1}}y=-1;let w=[],_=1,S=u+v;const P=1<<u-1;for(let T=0;T<u;T+=1){let A=0,O=S;for(;A<O;)ro(t,{errors:T,currentLocation:h+O,expectedLocation:h,distance:r,ignoreLocation:d})<=g?A=O:S=O,O=Math.floor((S-A)/2+A);S=O;let Z=Math.max(1,h-O+1),K=i?v:Math.min(h+O,v)+u,J=Array(K+2);J[K+1]=(1<<T)-1;for(let oe=K;oe>=Z;oe-=1){let ie=oe-1,Re=s[e.charAt(ie)];if(x&&(b[ie]=+!!Re),J[oe]=(J[oe+1]<<1|1)&Re,T&&(J[oe]|=(w[oe+1]|w[oe])<<1|1|w[oe+1]),J[oe]&P&&(_=ro(t,{errors:T,currentLocation:ie,expectedLocation:h,distance:r,ignoreLocation:d}),_<=g)){if(g=_,y=ie,y<=h)break;Z=Math.max(1,2*h-y)}}if(ro(t,{errors:T+1,currentLocation:h,expectedLocation:h,distance:r,ignoreLocation:d})>g)break;w=J}const I={isMatch:y>=0,score:Math.max(.001,_)};if(x){const T=il(b,c);T.length?l&&(I.indices=T):I.isMatch=!1}return I}function ll(e){let t={};for(let s=0,o=e.length;s<o;s+=1){const r=e.charAt(s);t[r]=(t[r]||0)|1<<o-s-1}return t}const po=String.prototype.normalize?(e=>e.normalize("NFD").replace(/[\u0300-\u036F\u0483-\u0489\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u0711\u0730-\u074A\u07A6-\u07B0\u07EB-\u07F3\u07FD\u0816-\u0819\u081B-\u0823\u0825-\u0827\u0829-\u082D\u0859-\u085B\u08D3-\u08E1\u08E3-\u0903\u093A-\u093C\u093E-\u094F\u0951-\u0957\u0962\u0963\u0981-\u0983\u09BC\u09BE-\u09C4\u09C7\u09C8\u09CB-\u09CD\u09D7\u09E2\u09E3\u09FE\u0A01-\u0A03\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A70\u0A71\u0A75\u0A81-\u0A83\u0ABC\u0ABE-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AE2\u0AE3\u0AFA-\u0AFF\u0B01-\u0B03\u0B3C\u0B3E-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B56\u0B57\u0B62\u0B63\u0B82\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD7\u0C00-\u0C04\u0C3E-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C62\u0C63\u0C81-\u0C83\u0CBC\u0CBE-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CE2\u0CE3\u0D00-\u0D03\u0D3B\u0D3C\u0D3E-\u0D44\u0D46-\u0D48\u0D4A-\u0D4D\u0D57\u0D62\u0D63\u0D82\u0D83\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DF2\u0DF3\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\u0EB1\u0EB4-\u0EB9\u0EBB\u0EBC\u0EC8-\u0ECD\u0F18\u0F19\u0F35\u0F37\u0F39\u0F3E\u0F3F\u0F71-\u0F84\u0F86\u0F87\u0F8D-\u0F97\u0F99-\u0FBC\u0FC6\u102B-\u103E\u1056-\u1059\u105E-\u1060\u1062-\u1064\u1067-\u106D\u1071-\u1074\u1082-\u108D\u108F\u109A-\u109D\u135D-\u135F\u1712-\u1714\u1732-\u1734\u1752\u1753\u1772\u1773\u17B4-\u17D3\u17DD\u180B-\u180D\u1885\u1886\u18A9\u1920-\u192B\u1930-\u193B\u1A17-\u1A1B\u1A55-\u1A5E\u1A60-\u1A7C\u1A7F\u1AB0-\u1ABE\u1B00-\u1B04\u1B34-\u1B44\u1B6B-\u1B73\u1B80-\u1B82\u1BA1-\u1BAD\u1BE6-\u1BF3\u1C24-\u1C37\u1CD0-\u1CD2\u1CD4-\u1CE8\u1CED\u1CF2-\u1CF4\u1CF7-\u1CF9\u1DC0-\u1DF9\u1DFB-\u1DFF\u20D0-\u20F0\u2CEF-\u2CF1\u2D7F\u2DE0-\u2DFF\u302A-\u302F\u3099\u309A\uA66F-\uA672\uA674-\uA67D\uA69E\uA69F\uA6F0\uA6F1\uA802\uA806\uA80B\uA823-\uA827\uA880\uA881\uA8B4-\uA8C5\uA8E0-\uA8F1\uA8FF\uA926-\uA92D\uA947-\uA953\uA980-\uA983\uA9B3-\uA9C0\uA9E5\uAA29-\uAA36\uAA43\uAA4C\uAA4D\uAA7B-\uAA7D\uAAB0\uAAB2-\uAAB4\uAAB7\uAAB8\uAABE\uAABF\uAAC1\uAAEB-\uAAEF\uAAF5\uAAF6\uABE3-\uABEA\uABEC\uABED\uFB1E\uFE00-\uFE0F\uFE20-\uFE2F]/g,"")):(e=>e);class Qa{constructor(t,{location:s=j.location,threshold:o=j.threshold,distance:r=j.distance,includeMatches:a=j.includeMatches,findAllMatches:i=j.findAllMatches,minMatchCharLength:c=j.minMatchCharLength,isCaseSensitive:l=j.isCaseSensitive,ignoreDiacritics:d=j.ignoreDiacritics,ignoreLocation:u=j.ignoreLocation}={}){if(this.options={location:s,threshold:o,distance:r,includeMatches:a,findAllMatches:i,minMatchCharLength:c,isCaseSensitive:l,ignoreDiacritics:d,ignoreLocation:u},t=l?t:t.toLowerCase(),t=d?po(t):t,this.pattern=t,this.chunks=[],!this.pattern.length)return;const v=(g,y)=>{this.chunks.push({pattern:g,alphabet:ll(g),startIndex:y})},h=this.pattern.length;if(h>Jt){let g=0;const y=h%Jt,x=h-y;for(;g<x;)v(this.pattern.substr(g,Jt),g),g+=Jt;if(y){const b=h-Jt;v(this.pattern.substr(b),b)}}else v(this.pattern,0)}searchIn(t){const{isCaseSensitive:s,ignoreDiacritics:o,includeMatches:r}=this.options;if(t=s?t:t.toLowerCase(),t=o?po(t):t,this.pattern===t){let x={isMatch:!0,score:0};return r&&(x.indices=[[0,t.length-1]]),x}const{location:a,distance:i,threshold:c,findAllMatches:l,minMatchCharLength:d,ignoreLocation:u}=this.options;let v=[],h=0,g=!1;this.chunks.forEach(({pattern:x,alphabet:b,startIndex:k})=>{const{isMatch:w,score:_,indices:S}=cl(t,x,b,{location:a+k,distance:i,threshold:c,findAllMatches:l,minMatchCharLength:d,includeMatches:r,ignoreLocation:u});w&&(g=!0),h+=_,w&&S&&(v=[...v,...S])});let y={isMatch:g,score:g?h/this.chunks.length:1};return g&&r&&(y.indices=v),y}}class Bt{constructor(t){this.pattern=t}static isMultiMatch(t){return Zr(t,this.multiRegex)}static isSingleMatch(t){return Zr(t,this.singleRegex)}search(){}}function Zr(e,t){const s=e.match(t);return s?s[1]:null}class dl extends Bt{constructor(t){super(t)}static get type(){return"exact"}static get multiRegex(){return/^="(.*)"$/}static get singleRegex(){return/^=(.*)$/}search(t){const s=t===this.pattern;return{isMatch:s,score:s?0:1,indices:[0,this.pattern.length-1]}}}class pl extends Bt{constructor(t){super(t)}static get type(){return"inverse-exact"}static get multiRegex(){return/^!"(.*)"$/}static get singleRegex(){return/^!(.*)$/}search(t){const o=t.indexOf(this.pattern)===-1;return{isMatch:o,score:o?0:1,indices:[0,t.length-1]}}}class ul extends Bt{constructor(t){super(t)}static get type(){return"prefix-exact"}static get multiRegex(){return/^\^"(.*)"$/}static get singleRegex(){return/^\^(.*)$/}search(t){const s=t.startsWith(this.pattern);return{isMatch:s,score:s?0:1,indices:[0,this.pattern.length-1]}}}class hl extends Bt{constructor(t){super(t)}static get type(){return"inverse-prefix-exact"}static get multiRegex(){return/^!\^"(.*)"$/}static get singleRegex(){return/^!\^(.*)$/}search(t){const s=!t.startsWith(this.pattern);return{isMatch:s,score:s?0:1,indices:[0,t.length-1]}}}class ml extends Bt{constructor(t){super(t)}static get type(){return"suffix-exact"}static get multiRegex(){return/^"(.*)"\$$/}static get singleRegex(){return/^(.*)\$$/}search(t){const s=t.endsWith(this.pattern);return{isMatch:s,score:s?0:1,indices:[t.length-this.pattern.length,t.length-1]}}}class fl extends Bt{constructor(t){super(t)}static get type(){return"inverse-suffix-exact"}static get multiRegex(){return/^!"(.*)"\$$/}static get singleRegex(){return/^!(.*)\$$/}search(t){const s=!t.endsWith(this.pattern);return{isMatch:s,score:s?0:1,indices:[0,t.length-1]}}}class Ya extends Bt{constructor(t,{location:s=j.location,threshold:o=j.threshold,distance:r=j.distance,includeMatches:a=j.includeMatches,findAllMatches:i=j.findAllMatches,minMatchCharLength:c=j.minMatchCharLength,isCaseSensitive:l=j.isCaseSensitive,ignoreDiacritics:d=j.ignoreDiacritics,ignoreLocation:u=j.ignoreLocation}={}){super(t),this._bitapSearch=new Qa(t,{location:s,threshold:o,distance:r,includeMatches:a,findAllMatches:i,minMatchCharLength:c,isCaseSensitive:l,ignoreDiacritics:d,ignoreLocation:u})}static get type(){return"fuzzy"}static get multiRegex(){return/^"(.*)"$/}static get singleRegex(){return/^(.*)$/}search(t){return this._bitapSearch.searchIn(t)}}class en extends Bt{constructor(t){super(t)}static get type(){return"include"}static get multiRegex(){return/^'"(.*)"$/}static get singleRegex(){return/^'(.*)$/}search(t){let s=0,o;const r=[],a=this.pattern.length;for(;(o=t.indexOf(this.pattern,s))>-1;)s=o+a,r.push([o,s-1]);const i=!!r.length;return{isMatch:i,score:i?0:1,indices:r}}}const er=[dl,en,ul,hl,fl,ml,pl,Ya],Vr=er.length,vl=/ +(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/,gl="|";function bl(e,t={}){return e.split(gl).map(s=>{let o=s.trim().split(vl).filter(a=>a&&!!a.trim()),r=[];for(let a=0,i=o.length;a<i;a+=1){const c=o[a];let l=!1,d=-1;for(;!l&&++d<Vr;){const u=er[d];let v=u.isMultiMatch(c);v&&(r.push(new u(v,t)),l=!0)}if(!l)for(d=-1;++d<Vr;){const u=er[d];let v=u.isSingleMatch(c);if(v){r.push(new u(v,t));break}}}return r})}const yl=new Set([Ya.type,en.type]);class xl{constructor(t,{isCaseSensitive:s=j.isCaseSensitive,ignoreDiacritics:o=j.ignoreDiacritics,includeMatches:r=j.includeMatches,minMatchCharLength:a=j.minMatchCharLength,ignoreLocation:i=j.ignoreLocation,findAllMatches:c=j.findAllMatches,location:l=j.location,threshold:d=j.threshold,distance:u=j.distance}={}){this.query=null,this.options={isCaseSensitive:s,ignoreDiacritics:o,includeMatches:r,minMatchCharLength:a,findAllMatches:c,ignoreLocation:i,location:l,threshold:d,distance:u},t=s?t:t.toLowerCase(),t=o?po(t):t,this.pattern=t,this.query=bl(this.pattern,this.options)}static condition(t,s){return s.useExtendedSearch}searchIn(t){const s=this.query;if(!s)return{isMatch:!1,score:1};const{includeMatches:o,isCaseSensitive:r,ignoreDiacritics:a}=this.options;t=r?t:t.toLowerCase(),t=a?po(t):t;let i=0,c=[],l=0;for(let d=0,u=s.length;d<u;d+=1){const v=s[d];c.length=0,i=0;for(let h=0,g=v.length;h<g;h+=1){const y=v[h],{isMatch:x,indices:b,score:k}=y.search(t);if(x){if(i+=1,l+=k,o){const w=y.constructor.type;yl.has(w)?c=[...c,...b]:c.push(b)}}else{l=0,i=0,c.length=0;break}}if(i){let h={isMatch:!0,score:l/i};return o&&(h.indices=c),h}}return{isMatch:!1,score:1}}}const tr=[];function wl(...e){tr.push(...e)}function sr(e,t){for(let s=0,o=tr.length;s<o;s+=1){let r=tr[s];if(r.condition(e,t))return new r(e,t)}return new Qa(e,t)}const uo={AND:"$and",OR:"$or"},or={PATH:"$path",PATTERN:"$val"},rr=e=>!!(e[uo.AND]||e[uo.OR]),kl=e=>!!e[or.PATH],Rl=e=>!At(e)&&Za(e)&&!rr(e),Kr=e=>({[uo.AND]:Object.keys(e).map(t=>({[t]:e[t]}))});function tn(e,t,{auto:s=!0}={}){const o=r=>{let a=Object.keys(r);const i=kl(r);if(!i&&a.length>1&&!rr(r))return o(Kr(r));if(Rl(r)){const l=i?r[or.PATH]:a[0],d=i?r[or.PATTERN]:r[l];if(!mt(d))throw new Error(Zc(l));const u={keyId:Yo(l),pattern:d};return s&&(u.searcher=sr(d,t)),u}let c={children:[],operator:a[0]};return a.forEach(l=>{const d=r[l];At(d)&&d.forEach(u=>{c.children.push(o(u))})}),c};return rr(e)||(e=Kr(e)),o(e)}function _l(e,{ignoreFieldNorm:t=j.ignoreFieldNorm}){e.forEach(s=>{let o=1;s.matches.forEach(({key:r,norm:a,score:i})=>{const c=r?r.weight:null;o*=Math.pow(i===0&&c?Number.EPSILON:i,(c||1)*(t?1:a))}),s.score=o})}function Cl(e,t){const s=e.matches;t.matches=[],Je(s)&&s.forEach(o=>{if(!Je(o.indices)||!o.indices.length)return;const{indices:r,value:a}=o;let i={indices:r,value:a};o.key&&(i.key=o.key.src),o.idx>-1&&(i.refIndex=o.idx),t.matches.push(i)})}function Sl(e,t){t.score=e.score}function Tl(e,t,{includeMatches:s=j.includeMatches,includeScore:o=j.includeScore}={}){const r=[];return s&&r.push(Cl),o&&r.push(Sl),e.map(a=>{const{idx:i}=a,c={item:t[i],refIndex:i};return r.length&&r.forEach(l=>{l(a,c)}),c})}class Es{constructor(t,s={},o){this.options={...j,...s},this.options.useExtendedSearch,this._keyStore=new Qc(this.options.keys),this.setCollection(t,o)}setCollection(t,s){if(this._docs=t,s&&!(s instanceof br))throw new Error(Wc);this._myIndex=s||Xa(this.options.keys,this._docs,{getFn:this.options.getFn,fieldNormWeight:this.options.fieldNormWeight})}add(t){Je(t)&&(this._docs.push(t),this._myIndex.add(t))}remove(t=()=>!1){const s=[];for(let o=0,r=this._docs.length;o<r;o+=1){const a=this._docs[o];t(a,o)&&(this.removeAt(o),o-=1,r-=1,s.push(a))}return s}removeAt(t){this._docs.splice(t,1),this._myIndex.removeAt(t)}getIndex(){return this._myIndex}search(t,{limit:s=-1}={}){const{includeMatches:o,includeScore:r,shouldSort:a,sortFn:i,ignoreFieldNorm:c}=this.options;let l=mt(t)?mt(this._docs[0])?this._searchStringList(t):this._searchObjectList(t):this._searchLogical(t);return _l(l,{ignoreFieldNorm:c}),a&&l.sort(i),Wa(s)&&s>-1&&(l=l.slice(0,s)),Tl(l,this._docs,{includeMatches:o,includeScore:r})}_searchStringList(t){const s=sr(t,this.options),{records:o}=this._myIndex,r=[];return o.forEach(({v:a,i,n:c})=>{if(!Je(a))return;const{isMatch:l,score:d,indices:u}=s.searchIn(a);l&&r.push({item:a,idx:i,matches:[{score:d,value:a,norm:c,indices:u}]})}),r}_searchLogical(t){const s=tn(t,this.options),o=(c,l,d)=>{if(!c.children){const{keyId:v,searcher:h}=c,g=this._findMatches({key:this._keyStore.get(v),value:this._myIndex.getValueForItemAtKeyId(l,v),searcher:h});return g&&g.length?[{idx:d,item:l,matches:g}]:[]}const u=[];for(let v=0,h=c.children.length;v<h;v+=1){const g=c.children[v],y=o(g,l,d);if(y.length)u.push(...y);else if(c.operator===uo.AND)return[]}return u},r=this._myIndex.records,a={},i=[];return r.forEach(({$:c,i:l})=>{if(Je(c)){let d=o(s,c,l);d.length&&(a[l]||(a[l]={idx:l,item:c,matches:[]},i.push(a[l])),d.forEach(({matches:u})=>{a[l].matches.push(...u)}))}}),i}_searchObjectList(t){const s=sr(t,this.options),{keys:o,records:r}=this._myIndex,a=[];return r.forEach(({$:i,i:c})=>{if(!Je(i))return;let l=[];o.forEach((d,u)=>{l.push(...this._findMatches({key:d,value:i[u],searcher:s}))}),l.length&&a.push({idx:c,item:i,matches:l})}),a}_findMatches({key:t,value:s,searcher:o}){if(!Je(s))return[];let r=[];if(At(s))s.forEach(({v:a,i,n:c})=>{if(!Je(a))return;const{isMatch:l,score:d,indices:u}=o.searchIn(a);l&&r.push({score:d,key:t,value:a,idx:i,norm:c,indices:u})});else{const{v:a,n:i}=s,{isMatch:c,score:l,indices:d}=o.searchIn(a);c&&r.push({score:l,key:t,value:a,norm:i,indices:d})}return r}}Es.version="7.1.0";Es.createIndex=Xa;Es.parseIndex=nl;Es.config=j;Es.parseQuery=tn;wl(xl);const Xr=[{title:"Introduction to Rezo",path:"/docs",category:"Getting Started",content:"Rezo is an enterprise-grade HTTP client library for Node.js and browsers. It provides a powerful and flexible API for making HTTP requests.",type:"page"},{title:"Installation",path:"/installation",category:"Getting Started",content:"npm install rezo bun add rezo pnpm add rezo yarn add rezo Node.js 22+ required ESM CommonJS TypeScript",type:"page"},{title:"Quick Start",path:"/quick-start",category:"Getting Started",content:"Making your first HTTP request GET POST PUT DELETE PATCH import rezo async await response data headers status",type:"page"},{title:"Why Rezo?",path:"/why-rezo",category:"Getting Started",content:"HTTP/2 support cookies proxy streaming adapters enterprise-grade TypeScript tree-shakeable performance universal runtime",type:"page"},{title:"GET Request",path:"/requests",category:"HTTP Methods",content:"rezo.get() fetch data retrieve resource query parameters URL params",type:"concept"},{title:"POST Request",path:"/requests",category:"HTTP Methods",content:"rezo.post() send data create resource request body JSON FormData",type:"concept"},{title:"PUT Request",path:"/requests",category:"HTTP Methods",content:"rezo.put() update resource replace data modify endpoint",type:"concept"},{title:"PATCH Request",path:"/requests",category:"HTTP Methods",content:"rezo.patch() partial update modify fields incremental change",type:"concept"},{title:"DELETE Request",path:"/requests",category:"HTTP Methods",content:"rezo.delete() remove resource destroy endpoint",type:"concept"},{title:"HEAD Request",path:"/requests",category:"HTTP Methods",content:"rezo.head() get headers without body metadata check resource exists",type:"concept"},{title:"OPTIONS Request",path:"/requests",category:"HTTP Methods",content:"rezo.options() CORS preflight allowed methods headers",type:"concept"},{title:"Request Headers",path:"/requests",category:"Request Configuration",content:"headers Authorization Content-Type Accept User-Agent custom headers",type:"concept"},{title:"Request Body",path:"/requests",category:"Request Configuration",content:"body JSON object FormData URLSearchParams Buffer Stream string",type:"concept"},{title:"Query Parameters",path:"/requests",category:"Request Configuration",content:"params query string URL parameters key value pairs searchParams",type:"concept"},{title:"Base URL",path:"/configuration",category:"Request Configuration",content:"baseURL prefix URL endpoint API base path",type:"concept"},{title:"Request Timeout",path:"/configuration",category:"Request Configuration",content:"timeout milliseconds ms request limit AbortController signal",type:"concept"},{title:"Authentication",path:"/requests",category:"Request Configuration",content:"auth Bearer token Basic auth Authorization header API key JWT",type:"concept"},{title:"Response Data",path:"/responses",category:"Response Handling",content:"response.data JSON object parsed body automatic content-type detection",type:"concept"},{title:"Response Status",path:"/responses",category:"Response Handling",content:"status statusText HTTP status code 200 201 404 500 response.status",type:"concept"},{title:"Response Headers",path:"/responses",category:"Response Handling",content:"response.headers getHeader content-type set-cookie access-control",type:"concept"},{title:"Response Cookies",path:"/responses",category:"Response Handling",content:"response.cookies Set-Cookie parsed cookies cookie attributes",type:"concept"},{title:"Response Timing",path:"/responses",category:"Response Handling",content:"response.timing DNS lookup TCP TLS TTFB duration performance metrics",type:"concept"},{title:"RezoError",path:"/errors",category:"Error Handling",content:"RezoError try catch error handling isRezoError error.status error.data structured errors",type:"concept"},{title:"Network Errors",path:"/errors",category:"Error Handling",content:"ECONNREFUSED ETIMEDOUT ENOTFOUND DNS resolution connection refused network failure",type:"concept"},{title:"HTTP Status Errors",path:"/errors",category:"Error Handling",content:"4xx 5xx client error server error 400 401 403 404 500 502 503",type:"concept"},{title:"Timeout Errors",path:"/errors",category:"Error Handling",content:"request timeout isTimeout ETIMEDOUT socket timeout connection timeout",type:"concept"},{title:"Error Retry",path:"/errors",category:"Error Handling",content:"isRetryable retry on error automatic retry exponential backoff",type:"concept"},{title:"Adapters Overview",path:"/adapters",category:"Adapters",content:"adapter system pluggable architecture environment detection auto-select tree-shaking",type:"page"},{title:"HTTP Adapter",path:"/adapters/http",category:"Adapters",content:"Node.js native http https full-featured cookies proxy streaming decompression gzip brotli zstd",type:"page"},{title:"HTTP/2 Adapter",path:"/adapters/http2",category:"Adapters",content:"HTTP/2 multiplexing session pooling ALPN negotiation connection reuse server push performance",type:"page"},{title:"Fetch Adapter",path:"/adapters/fetch",category:"Adapters",content:"browser fetch API universal edge workers Cloudflare Vercel Deno Bun Web API",type:"page"},{title:"cURL Adapter",path:"/adapters/curl",category:"Adapters",content:"curl command line wrapper advanced auth NTLM digest Kerberos negotiate SSL certificates",type:"page"},{title:"XHR Adapter",path:"/adapters/xhr",category:"Adapters",content:"XMLHttpRequest legacy browsers Internet Explorer compatibility upload progress download progress",type:"page"},{title:"React Native Adapter",path:"/adapters/react-native",category:"Adapters",content:"React Native mobile iOS Android Expo fetch networking FormData file upload",type:"page"},{title:"HTTP/2 Multiplexing",path:"/adapters/http2",category:"HTTP/2 Features",content:"multiplexed connections single connection multiple streams concurrent requests",type:"concept"},{title:"HTTP/2 Session Pooling",path:"/adapters/http2",category:"HTTP/2 Features",content:"connection pool session reuse keep-alive persistent connections",type:"concept"},{title:"ALPN Negotiation",path:"/adapters/http2",category:"HTTP/2 Features",content:"Application-Layer Protocol Negotiation TLS handshake HTTP/2 upgrade",type:"concept"},{title:"Cookie Management",path:"/advanced/cookies",category:"Cookies",content:"CookieJar RezoCookieJar tough-cookie persistence domain path expires httpOnly secure sameSite Netscape JSON serialize deserialize",type:"page"},{title:"Cookie Jar",path:"/advanced/cookies",category:"Cookies",content:"RezoCookieJar cookie storage persistence automatic cookie handling session cookies",type:"concept"},{title:"Cookie Attributes",path:"/advanced/cookies",category:"Cookies",content:"expires maxAge domain path secure httpOnly sameSite cookie flags",type:"concept"},{title:"Cookie Serialization",path:"/advanced/cookies",category:"Cookies",content:"toJSON fromJSON serialize deserialize Netscape format cookie export import",type:"concept"},{title:"Proxy Support",path:"/advanced/proxy",category:"Proxy",content:"HTTP HTTPS SOCKS4 SOCKS5 proxy rotation ProxyManager round-robin random weighted health check authentication tunnel",type:"page"},{title:"HTTP Proxy",path:"/advanced/proxy",category:"Proxy",content:"HTTP proxy CONNECT tunnel proxy authentication proxy URL",type:"concept"},{title:"HTTPS Proxy",path:"/advanced/proxy",category:"Proxy",content:"HTTPS proxy TLS SSL encrypted proxy secure tunnel",type:"concept"},{title:"SOCKS Proxy",path:"/advanced/proxy",category:"Proxy",content:"SOCKS4 SOCKS5 proxy protocol TCP UDP proxy socks-proxy-agent",type:"concept"},{title:"Proxy Rotation",path:"/advanced/proxy",category:"Proxy",content:"ProxyManager rotate proxies round-robin random weighted selection proxy pool",type:"concept"},{title:"Proxy Health Check",path:"/advanced/proxy",category:"Proxy",content:"proxy health monitoring alive dead proxy status check interval",type:"concept"},{title:"Proxy Authentication",path:"/advanced/proxy",category:"Proxy",content:"proxy username password auth credentials Proxy-Authorization",type:"concept"},{title:"Streaming",path:"/advanced/streaming",category:"Streaming",content:"stream download upload progress file transfer ReadableStream WritableStream pipe chunked encoding large files",type:"page"},{title:"Download Progress",path:"/advanced/streaming",category:"Streaming",content:"download progress bytes downloaded total bytes percentage progress callback",type:"concept"},{title:"Upload Progress",path:"/advanced/streaming",category:"Streaming",content:"upload progress bytes uploaded total bytes percentage progress callback",type:"concept"},{title:"Stream Response",path:"/advanced/streaming",category:"Streaming",content:"StreamResponse ReadableStream Node.js stream chunked transfer",type:"concept"},{title:"File Download",path:"/advanced/streaming",category:"Streaming",content:"download file save to disk writeStream pipe file output",type:"concept"},{title:"File Upload",path:"/advanced/streaming",category:"Streaming",content:"upload file FormData multipart file input file stream",type:"concept"},{title:"Retry & Backoff",path:"/advanced/retry",category:"Retry",content:"retry exponential backoff status codes attempts delay maxRetries retryCondition retryDelay 429 503 Retry-After",type:"page"},{title:"Retry Configuration",path:"/advanced/retry",category:"Retry",content:"maxRetries retries attempts retry count limit",type:"concept"},{title:"Exponential Backoff",path:"/advanced/retry",category:"Retry",content:"exponential delay backoff factor increasing delay wait time",type:"concept"},{title:"Retry Condition",path:"/advanced/retry",category:"Retry",content:"retryCondition shouldRetry retry predicate custom retry logic",type:"concept"},{title:"Rate Limiting",path:"/advanced/retry",category:"Retry",content:"429 Too Many Requests Retry-After rate limit throttle",type:"concept"},{title:"Hooks & Interceptors",path:"/advanced/hooks",category:"Hooks",content:"beforeRequest afterResponse onError interceptors middleware request transform response transform authentication refresh token",type:"page"},{title:"Before Request Hook",path:"/advanced/hooks",category:"Hooks",content:"beforeRequest request interceptor modify request add headers auth token",type:"concept"},{title:"After Response Hook",path:"/advanced/hooks",category:"Hooks",content:"afterResponse response interceptor transform response logging",type:"concept"},{title:"Error Hook",path:"/advanced/hooks",category:"Hooks",content:"onError error interceptor error handling custom error processing",type:"concept"},{title:"Request Interceptor",path:"/advanced/hooks",category:"Hooks",content:"interceptor middleware chain request pipeline modify request",type:"concept"},{title:"Token Refresh",path:"/advanced/hooks",category:"Hooks",content:"refresh token JWT expired token automatic refresh 401 unauthorized",type:"concept"},{title:"Request Queue",path:"/advanced/queue",category:"Queue",content:"queue RezoQueue HttpQueue concurrency rate limiting priority throttle per-domain limits batch requests",type:"page"},{title:"Concurrency Control",path:"/advanced/queue",category:"Queue",content:"concurrent requests limit parallel requests max connections",type:"concept"},{title:"Rate Limiting Queue",path:"/advanced/queue",category:"Queue",content:"requests per second rate limit throttle delay between requests",type:"concept"},{title:"Priority Queue",path:"/advanced/queue",category:"Queue",content:"priority high low urgent request priority ordering",type:"concept"},{title:"Per-Domain Limits",path:"/advanced/queue",category:"Queue",content:"domain limits per-host limits connection limit per domain",type:"concept"},{title:"TLS & Security",path:"/advanced/security",category:"Security",content:"TLS SSL certificates CA custom certificate chain client certificates mTLS pinning rejectUnauthorized",type:"page"},{title:"TLS Configuration",path:"/advanced/security",category:"Security",content:"TLS options SSL settings secure context",type:"concept"},{title:"Custom CA Certificate",path:"/advanced/security",category:"Security",content:"CA certificate custom CA root certificate trust chain",type:"concept"},{title:"Client Certificate",path:"/advanced/security",category:"Security",content:"client cert mTLS mutual TLS client authentication certificate key",type:"concept"},{title:"Certificate Pinning",path:"/advanced/security",category:"Security",content:"certificate pinning pin public key fingerprint security",type:"concept"},{title:"Skip Certificate Validation",path:"/advanced/security",category:"Security",content:"rejectUnauthorized false skip SSL verification insecure self-signed",type:"concept"},{title:"Performance",path:"/advanced/performance",category:"Performance",content:"performance metrics RezoPerformance timing DNS TCP TLS TTFB total duration connection pooling keep-alive",type:"page"},{title:"Performance Metrics",path:"/advanced/performance",category:"Performance",content:"RezoPerformance timing metrics measurement",type:"concept"},{title:"DNS Lookup Time",path:"/advanced/performance",category:"Performance",content:"DNS lookup duration hostname resolution time",type:"concept"},{title:"TCP Connection Time",path:"/advanced/performance",category:"Performance",content:"TCP connect duration socket connection time",type:"concept"},{title:"TLS Handshake Time",path:"/advanced/performance",category:"Performance",content:"TLS handshake duration SSL negotiation time",type:"concept"},{title:"Time to First Byte",path:"/advanced/performance",category:"Performance",content:"TTFB first byte latency server response time",type:"concept"},{title:"Connection Pooling",path:"/advanced/performance",category:"Performance",content:"connection pool keep-alive reuse connections persistent",type:"concept"},{title:"Rezo Instance",path:"/api/instance",category:"API Reference",content:"rezo.create instance methods get post put patch delete head options request defaults extend",type:"api"},{title:"rezo.create()",path:"/api/instance",category:"API Reference",content:"create instance custom defaults configuration new instance",type:"api"},{title:"Instance Methods",path:"/api/instance",category:"API Reference",content:"get post put patch delete head options request methods",type:"api"},{title:"Instance Defaults",path:"/api/instance",category:"API Reference",content:"defaults config baseURL headers timeout auth adapter",type:"api"},{title:"Request Options",path:"/api/options",category:"API Reference",content:"RequestOptions url method headers body timeout proxy auth retry hooks adapter jar signal",type:"api"},{title:"url option",path:"/api/options",category:"API Reference",content:"url endpoint path request URL string",type:"api"},{title:"method option",path:"/api/options",category:"API Reference",content:"method GET POST PUT PATCH DELETE HEAD OPTIONS",type:"api"},{title:"headers option",path:"/api/options",category:"API Reference",content:"headers object key value pairs request headers",type:"api"},{title:"body option",path:"/api/options",category:"API Reference",content:"body data payload JSON object FormData string",type:"api"},{title:"timeout option",path:"/api/options",category:"API Reference",content:"timeout milliseconds request timeout limit",type:"api"},{title:"proxy option",path:"/api/options",category:"API Reference",content:"proxy configuration HTTP HTTPS SOCKS proxy URL",type:"api"},{title:"adapter option",path:"/api/options",category:"API Reference",content:"adapter http http2 fetch curl xhr react-native",type:"api"},{title:"jar option",path:"/api/options",category:"API Reference",content:"jar cookie jar CookieJar RezoCookieJar",type:"api"},{title:"signal option",path:"/api/options",category:"API Reference",content:"signal AbortSignal AbortController cancel request",type:"api"},{title:"Response Object",path:"/api/response",category:"API Reference",content:"RezoResponse data status statusText headers cookies url ok redirected type timing",type:"api"},{title:"response.data",path:"/api/response",category:"API Reference",content:"data property parsed response body JSON object",type:"api"},{title:"response.status",path:"/api/response",category:"API Reference",content:"status HTTP status code 200 201 404 500",type:"api"},{title:"response.headers",path:"/api/response",category:"API Reference",content:"headers response headers object key value",type:"api"},{title:"response.cookies",path:"/api/response",category:"API Reference",content:"cookies parsed cookies Set-Cookie header",type:"api"},{title:"response.ok",path:"/api/response",category:"API Reference",content:"ok boolean 2xx success status",type:"api"},{title:"RezoError Class",path:"/api/error",category:"API Reference",content:"RezoError isRezoError code message status data config request response isTimeout isNetwork",type:"api"},{title:"error.status",path:"/api/error",category:"API Reference",content:"error status HTTP status code error.status",type:"api"},{title:"error.data",path:"/api/error",category:"API Reference",content:"error data response body error message",type:"api"},{title:"error.code",path:"/api/error",category:"API Reference",content:"error code ETIMEDOUT ECONNREFUSED network error",type:"api"},{title:"isRezoError()",path:"/api/error",category:"API Reference",content:"isRezoError type guard check error type",type:"api"},{title:"RezoFormData",path:"/api/formdata",category:"API Reference",content:"RezoFormData fromObject append set get getAll delete has entries file upload multipart",type:"api"},{title:"RezoFormData.fromObject()",path:"/api/formdata",category:"API Reference",content:"fromObject create FormData from object nested arrays",type:"api"},{title:"FormData.append()",path:"/api/formdata",category:"API Reference",content:"append add field value file to FormData",type:"api"},{title:"CookieJar API",path:"/api/cookiejar",category:"API Reference",content:"RezoCookieJar getCookies setCookie serialize deserialize toJSON fromJSON clear domain path",type:"api"},{title:"jar.getCookies()",path:"/api/cookiejar",category:"API Reference",content:"getCookies get cookies for URL domain",type:"api"},{title:"jar.setCookie()",path:"/api/cookiejar",category:"API Reference",content:"setCookie set cookie for URL domain",type:"api"},{title:"jar.toJSON()",path:"/api/cookiejar",category:"API Reference",content:"toJSON serialize cookies to JSON export",type:"api"},{title:"jar.fromJSON()",path:"/api/cookiejar",category:"API Reference",content:"fromJSON deserialize cookies from JSON import",type:"api"},{title:"TypeScript Types",path:"/api/types",category:"API Reference",content:"TypeScript types interfaces RequestOptions RezoResponse RezoError Adapter ProxyConfig RetryConfig HooksConfig",type:"api"},{title:"RequestOptions type",path:"/api/types",category:"API Reference",content:"RequestOptions interface TypeScript type definition",type:"api"},{title:"RezoResponse type",path:"/api/types",category:"API Reference",content:"RezoResponse interface TypeScript type definition",type:"api"},{title:"RezoError type",path:"/api/types",category:"API Reference",content:"RezoError class TypeScript type definition",type:"api"},{title:"Migrate from Axios",path:"/migration/axios",category:"Migration",content:"axios migration guide differences compatibility interceptors hooks error handling CancelToken AbortController",type:"guide"},{title:"Axios Interceptors to Hooks",path:"/migration/axios",category:"Migration",content:"axios.interceptors to hooks beforeRequest afterResponse migration",type:"guide"},{title:"Axios CancelToken to AbortController",path:"/migration/axios",category:"Migration",content:"CancelToken AbortController cancel request migration",type:"guide"},{title:"Migrate from Got",path:"/migration/got",category:"Migration",content:"got migration hooks retry pagination stream body response parsing options mapping",type:"guide"},{title:"Migrate from node-fetch",path:"/migration/node-fetch",category:"Migration",content:"node-fetch migration Response clone json text headers status fetch API compatibility",type:"guide"},{title:"Examples",path:"/examples",category:"Resources",content:"code examples recipes patterns authentication file upload download streaming proxy webscraping API integration",type:"page"},{title:"Authentication Example",path:"/examples",category:"Examples",content:"auth example Bearer token JWT login logout refresh token",type:"example"},{title:"File Upload Example",path:"/examples",category:"Examples",content:"upload file FormData multipart file input example",type:"example"},{title:"File Download Example",path:"/examples",category:"Examples",content:"download file stream save to disk example",type:"example"},{title:"Proxy Example",path:"/examples",category:"Examples",content:"proxy configuration HTTP SOCKS proxy example",type:"example"},{title:"Retry Example",path:"/examples",category:"Examples",content:"retry exponential backoff error handling example",type:"example"},{title:"Streaming Example",path:"/examples",category:"Examples",content:"stream response download upload progress example",type:"example"},{title:"FAQ",path:"/faq",category:"Resources",content:"frequently asked questions troubleshooting common issues browser Node.js Bun Deno edge runtime",type:"page"},{title:"Changelog",path:"/changelog",category:"Resources",content:"changelog version history releases updates breaking changes new features bug fixes",type:"page"},{title:"Contributing",path:"/contributing",category:"Resources",content:"contributing guide pull requests issues bug reports feature requests development setup testing",type:"page"},{title:"Node.js Runtime",path:"/why-rezo",category:"Runtimes",content:"Node.js runtime server-side JavaScript v22+ required",type:"concept"},{title:"Bun Runtime",path:"/why-rezo",category:"Runtimes",content:"Bun runtime fast JavaScript TypeScript runtime",type:"concept"},{title:"Deno Runtime",path:"/why-rezo",category:"Runtimes",content:"Deno runtime secure TypeScript runtime",type:"concept"},{title:"Browser Runtime",path:"/why-rezo",category:"Runtimes",content:"browser client-side JavaScript DOM fetch API",type:"concept"},{title:"Edge Workers",path:"/why-rezo",category:"Runtimes",content:"edge workers Cloudflare Vercel Netlify edge runtime serverless",type:"concept"},{title:"React Native",path:"/why-rezo",category:"Runtimes",content:"React Native mobile iOS Android Expo",type:"concept"},{title:"Decompression",path:"/adapters/http",category:"Features",content:"gzip brotli zstd deflate automatic decompression Accept-Encoding",type:"concept"},{title:"Tree Shaking",path:"/why-rezo",category:"Features",content:"tree-shaking bundle size optimization import only what you need",type:"concept"},{title:"TypeScript Support",path:"/why-rezo",category:"Features",content:"TypeScript types definitions generics type safety IntelliSense",type:"concept"},{title:"Automatic JSON Parsing",path:"/responses",category:"Features",content:"automatic JSON parsing content-type detection response.data",type:"concept"},{title:"URL Encoding",path:"/requests",category:"Features",content:"URL encoding URLSearchParams query string encoding",type:"concept"},{title:"FormData Encoding",path:"/requests",category:"Features",content:"FormData multipart encoding file upload nested objects arrays",type:"concept"}];var Al=N('<div class="px-4 py-8 text-center" style="color: var(--muted);"> </div>'),El=as('<svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color: var(--muted);"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>'),Il=N('<li><a style="color: var(--text);"><div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style="background-color: var(--surface);"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color: #00d4ff;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg></div> <div class="flex-1 min-w-0"><div class="font-medium truncate"> </div> <div class="text-sm truncate" style="color: var(--muted);"> </div></div> <!></a></li>'),zl=N('<ul class="py-2"></ul>'),Pl=N('<div class="fixed inset-0 bg-black/50 z-[100] flex items-start justify-center pt-[10vh] sm:pt-[15vh]" role="button" tabindex="-1" aria-label="Close search"><div class="w-full max-w-xl mx-4 rounded-xl shadow-2xl overflow-hidden" style="background-color: var(--bg); border: 1px solid var(--border);" role="dialog" aria-modal="true" tabindex="-1"><div class="flex items-center px-4 border-b" style="border-color: var(--border);"><svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color: var(--muted);"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg> <input type="text" placeholder="Search documentation..." class="flex-1 px-4 py-4 bg-transparent outline-none text-lg" style="color: var(--text);"/> <button class="cursor-pointer"><kbd class="px-2 py-1 text-xs rounded" style="background-color: var(--surface); color: var(--muted);">ESC</kbd></button></div> <div class="max-h-[60vh] overflow-y-auto"><!></div> <div class="flex items-center justify-between px-4 py-3 border-t text-xs" style="border-color: var(--border); color: var(--muted);"><div class="flex items-center gap-4"><span class="flex items-center gap-1"><kbd class="px-1.5 py-0.5 rounded" style="background-color: var(--surface);">↑↓</kbd> Navigate</span> <span class="flex items-center gap-1"><kbd class="px-1.5 py-0.5 rounded" style="background-color: var(--surface);">↵</kbd> Select</span></div> <span>Powered by Fuse.js</span></div></div></div>');function sn(e,t){he(t,!1);const s=()=>Fs(No,"$searchQuery",r),o=()=>Fs(Bs,"$searchOpen",r),[r,a]=yo(),i={page:"M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",concept:"M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z",api:"M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4",example:"M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z",guide:"M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"},c=new Es(Xr,{keys:[{name:"title",weight:4},{name:"content",weight:2},{name:"category",weight:1.5},{name:"type",weight:.5}],threshold:.35,includeScore:!0,ignoreLocation:!0,minMatchCharLength:2}),l=Xr.filter(w=>w.type==="page").slice(0,8);let d=Ke([]),u=Ke(0),v=Ke();function h(w){w.key==="ArrowDown"?(w.preventDefault(),de(u,Math.min(C(u)+1,C(d).length-1))):w.key==="ArrowUp"?(w.preventDefault(),de(u,Math.max(C(u)-1,0))):w.key==="Enter"&&C(d)[C(u)]?(w.preventDefault(),g(C(d)[C(u)].path)):w.key==="Escape"&&y()}function g(w){y(),setTimeout(()=>{be(w)},10)}function y(){Bs.set(!1),No.set("")}xo(()=>{setTimeout(()=>C(v)?.focus(),50)}),qs(()=>s(),()=>{s()&&s().length>=1?(de(d,c.search(s()).slice(0,12).map(w=>w.item)),de(u,0)):de(d,l)}),mr(),we();var x=Wo(),b=io(x);{var k=w=>{var _=Pl(),S=p(_),P=p(S),I=n(p(P),2);yc(I,J=>de(v,J),()=>C(v));var T=n(I,2),A=n(P,2),O=p(A);{var Z=J=>{var ye=Al(),oe=p(ye);pe(()=>Q(oe,`No results found for "${s()??""}"`)),E(J,ye)},K=J=>{var ye=zl();ze(ye,5,()=>C(d),Ie,(oe,ie,Re)=>{var it=Il(),Y=p(it);let fe;var _e=p(Y),Oe=p(_e),Le=p(Oe),Xe=n(_e,2),ns=p(Xe),is=p(ns),Is=n(ns,2),zs=p(Is),cs=n(Xe,2);{var Ws=ct=>{var Ps=El();E(ct,Ps)};Ze(cs,ct=>{Re===C(u)&&ct(Ws)})}pe(()=>{ks(Y,"href",(C(ie),Se(()=>"#"+C(ie).path))),fe=kt(Y,1,"flex items-center gap-3 px-4 py-3 transition-colors w-full text-left cursor-pointer svelte-1gvkdtx",null,fe,{selected:Re===C(u)}),ks(Le,"d",(C(ie),Se(()=>i[C(ie).type]||i.page))),Q(is,(C(ie),Se(()=>C(ie).title))),Q(zs,(C(ie),Se(()=>C(ie).category)))}),ee("click",Y,wc(()=>g(C(ie).path))),ee("mouseenter",Y,()=>de(u,Re)),E(oe,it)}),E(J,ye)};Ze(O,J=>{C(d),Se(()=>C(d).length===0)?J(Z):J(K,!1)})}bc(I,s,J=>_c(No,J)),ee("click",T,y),ee("click",S,xc(function(J){kc.call(this,t,J)})),ee("keydown",S,h),ee("click",_,y),ee("keydown",_,J=>J.key==="Escape"&&y()),E(w,_)};Ze(b,w=>{o()&&w(k)})}E(e,x),me(),a()}var Nl=N('<div class="min-h-screen transition-colors duration-300" style="background-color: var(--bg); color: var(--text);"><!> <!> <!> <main class="pt-16 lg:pl-72"><div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12"><!></div></main></div>');function Ml(e,t){he(t,!1);let s=Zt(t,"currentPath",8,"/");xo(()=>{Qo.init()}),we();var o=Nl(),r=p(o);Ja(r,{isLanding:!1});var a=n(r,2);Uc(a,{get currentPath(){return s()}});var i=n(a,2);sn(i,{});var c=n(i,2),l=p(c),d=p(l);nc(d,t,"default",{}),E(e,o),me()}const Dl=e=>e;function Ol(e){const t=e-1;return t*t*t+1}function Qr(e){const t=typeof e=="string"&&e.match(/^\s*(-?[\d.]+)([^\s]*)\s*$/);return t?[parseFloat(t[1]),t[2]||"px"]:[e,"px"]}function Do(e,{delay:t=0,duration:s=400,easing:o=Dl}={}){const r=+getComputedStyle(e).opacity;return{delay:t,duration:s,easing:o,css:a=>`opacity: ${a*r}`}}function Hl(e,{delay:t=0,duration:s=400,easing:o=Ol,x:r=0,y:a=0,opacity:i=0}={}){const c=getComputedStyle(e),l=+c.opacity,d=c.transform==="none"?"":c.transform,u=l*(1-i),[v,h]=Qr(r),[g,y]=Qr(a);return{delay:t,duration:s,easing:o,css:(x,b)=>`
			transform: ${d} translate(${(1-x)*v}${h}, ${(1-x)*g}${y});
			opacity: ${l-u*b}`}}function Oo(e){const t=e-1;return t*t*t+1}function Ll(e){return e&&e.__esModule&&Object.prototype.hasOwnProperty.call(e,"default")?e.default:e}var Ho,Yr;function ql(){if(Yr)return Ho;Yr=1;function e(m){return m instanceof Map?m.clear=m.delete=m.set=function(){throw new Error("map is read-only")}:m instanceof Set&&(m.add=m.clear=m.delete=function(){throw new Error("set is read-only")}),Object.freeze(m),Object.getOwnPropertyNames(m).forEach(R=>{const M=m[R],W=typeof M;(W==="object"||W==="function")&&!Object.isFrozen(M)&&e(M)}),m}class t{constructor(R){R.data===void 0&&(R.data={}),this.data=R.data,this.isMatchIgnored=!1}ignoreMatch(){this.isMatchIgnored=!0}}function s(m){return m.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#x27;")}function o(m,...R){const M=Object.create(null);for(const W in m)M[W]=m[W];return R.forEach(function(W){for(const ve in W)M[ve]=W[ve]}),M}const r="</span>",a=m=>!!m.scope,i=(m,{prefix:R})=>{if(m.startsWith("language:"))return m.replace("language:","language-");if(m.includes(".")){const M=m.split(".");return[`${R}${M.shift()}`,...M.map((W,ve)=>`${W}${"_".repeat(ve+1)}`)].join(" ")}return`${R}${m}`};class c{constructor(R,M){this.buffer="",this.classPrefix=M.classPrefix,R.walk(this)}addText(R){this.buffer+=s(R)}openNode(R){if(!a(R))return;const M=i(R.scope,{prefix:this.classPrefix});this.span(M)}closeNode(R){a(R)&&(this.buffer+=r)}value(){return this.buffer}span(R){this.buffer+=`<span class="${R}">`}}const l=(m={})=>{const R={children:[]};return Object.assign(R,m),R};class d{constructor(){this.rootNode=l(),this.stack=[this.rootNode]}get top(){return this.stack[this.stack.length-1]}get root(){return this.rootNode}add(R){this.top.children.push(R)}openNode(R){const M=l({scope:R});this.add(M),this.stack.push(M)}closeNode(){if(this.stack.length>1)return this.stack.pop()}closeAllNodes(){for(;this.closeNode(););}toJSON(){return JSON.stringify(this.rootNode,null,4)}walk(R){return this.constructor._walk(R,this.rootNode)}static _walk(R,M){return typeof M=="string"?R.addText(M):M.children&&(R.openNode(M),M.children.forEach(W=>this._walk(R,W)),R.closeNode(M)),R}static _collapse(R){typeof R!="string"&&R.children&&(R.children.every(M=>typeof M=="string")?R.children=[R.children.join("")]:R.children.forEach(M=>{d._collapse(M)}))}}class u extends d{constructor(R){super(),this.options=R}addText(R){R!==""&&this.add(R)}startScope(R){this.openNode(R)}endScope(){this.closeNode()}__addSublanguage(R,M){const W=R.root;M&&(W.scope=`language:${M}`),this.add(W)}toHTML(){return new c(this,this.options).value()}finalize(){return this.closeAllNodes(),!0}}function v(m){return m?typeof m=="string"?m:m.source:null}function h(m){return x("(?=",m,")")}function g(m){return x("(?:",m,")*")}function y(m){return x("(?:",m,")?")}function x(...m){return m.map(M=>v(M)).join("")}function b(m){const R=m[m.length-1];return typeof R=="object"&&R.constructor===Object?(m.splice(m.length-1,1),R):{}}function k(...m){return"("+(b(m).capture?"":"?:")+m.map(W=>v(W)).join("|")+")"}function w(m){return new RegExp(m.toString()+"|").exec("").length-1}function _(m,R){const M=m&&m.exec(R);return M&&M.index===0}const S=/\[(?:[^\\\]]|\\.)*\]|\(\??|\\([1-9][0-9]*)|\\./;function P(m,{joinWith:R}){let M=0;return m.map(W=>{M+=1;const ve=M;let ge=v(W),L="";for(;ge.length>0;){const H=S.exec(ge);if(!H){L+=ge;break}L+=ge.substring(0,H.index),ge=ge.substring(H.index+H[0].length),H[0][0]==="\\"&&H[1]?L+="\\"+String(Number(H[1])+ve):(L+=H[0],H[0]==="("&&M++)}return L}).map(W=>`(${W})`).join(R)}const I=/\b\B/,T="[a-zA-Z]\\w*",A="[a-zA-Z_]\\w*",O="\\b\\d+(\\.\\d+)?",Z="(-?)(\\b0[xX][a-fA-F0-9]+|(\\b\\d+(\\.\\d*)?|\\.\\d+)([eE][-+]?\\d+)?)",K="\\b(0b[01]+)",J="!|!=|!==|%|%=|&|&&|&=|\\*|\\*=|\\+|\\+=|,|-|-=|/=|/|:|;|<<|<<=|<=|<|===|==|=|>>>=|>>=|>=|>>>|>>|>|\\?|\\[|\\{|\\(|\\^|\\^=|\\||\\|=|\\|\\||~",ye=(m={})=>{const R=/^#![ ]*\//;return m.binary&&(m.begin=x(R,/.*\b/,m.binary,/\b.*/)),o({scope:"meta",begin:R,end:/$/,relevance:0,"on:begin":(M,W)=>{M.index!==0&&W.ignoreMatch()}},m)},oe={begin:"\\\\[\\s\\S]",relevance:0},ie={scope:"string",begin:"'",end:"'",illegal:"\\n",contains:[oe]},Re={scope:"string",begin:'"',end:'"',illegal:"\\n",contains:[oe]},it={begin:/\b(a|an|the|are|I'm|isn't|don't|doesn't|won't|but|just|should|pretty|simply|enough|gonna|going|wtf|so|such|will|you|your|they|like|more)\b/},Y=function(m,R,M={}){const W=o({scope:"comment",begin:m,end:R,contains:[]},M);W.contains.push({scope:"doctag",begin:"[ ]*(?=(TODO|FIXME|NOTE|BUG|OPTIMIZE|HACK|XXX):)",end:/(TODO|FIXME|NOTE|BUG|OPTIMIZE|HACK|XXX):/,excludeBegin:!0,relevance:0});const ve=k("I","a","is","so","us","to","at","if","in","it","on",/[A-Za-z]+['](d|ve|re|ll|t|s|n)/,/[A-Za-z]+[-][a-z]+/,/[A-Za-z][a-z]{2,}/);return W.contains.push({begin:x(/[ ]+/,"(",ve,/[.]?[:]?([.][ ]|[ ])/,"){3}")}),W},fe=Y("//","$"),_e=Y("/\\*","\\*/"),Oe=Y("#","$"),Le={scope:"number",begin:O,relevance:0},Xe={scope:"number",begin:Z,relevance:0},ns={scope:"number",begin:K,relevance:0},is={scope:"regexp",begin:/\/(?=[^/\n]*\/)/,end:/\/[gimuy]*/,contains:[oe,{begin:/\[/,end:/\]/,relevance:0,contains:[oe]}]},Is={scope:"title",begin:T,relevance:0},zs={scope:"title",begin:A,relevance:0},cs={begin:"\\.\\s*"+A,relevance:0};var ct=Object.freeze({__proto__:null,APOS_STRING_MODE:ie,BACKSLASH_ESCAPE:oe,BINARY_NUMBER_MODE:ns,BINARY_NUMBER_RE:K,COMMENT:Y,C_BLOCK_COMMENT_MODE:_e,C_LINE_COMMENT_MODE:fe,C_NUMBER_MODE:Xe,C_NUMBER_RE:Z,END_SAME_AS_BEGIN:function(m){return Object.assign(m,{"on:begin":(R,M)=>{M.data._beginMatch=R[1]},"on:end":(R,M)=>{M.data._beginMatch!==R[1]&&M.ignoreMatch()}})},HASH_COMMENT_MODE:Oe,IDENT_RE:T,MATCH_NOTHING_RE:I,METHOD_GUARD:cs,NUMBER_MODE:Le,NUMBER_RE:O,PHRASAL_WORDS_MODE:it,QUOTE_STRING_MODE:Re,REGEXP_MODE:is,RE_STARTERS_RE:J,SHEBANG:ye,TITLE_MODE:Is,UNDERSCORE_IDENT_RE:A,UNDERSCORE_TITLE_MODE:zs});function Ps(m,R){m.input[m.index-1]==="."&&R.ignoreMatch()}function wo(m,R){m.className!==void 0&&(m.scope=m.className,delete m.className)}function ko(m,R){R&&m.beginKeywords&&(m.begin="\\b("+m.beginKeywords.split(" ").join("|")+")(?!\\.)(?=\\b|\\s)",m.__beforeBegin=Ps,m.keywords=m.keywords||m.beginKeywords,delete m.beginKeywords,m.relevance===void 0&&(m.relevance=0))}function Ro(m,R){Array.isArray(m.illegal)&&(m.illegal=k(...m.illegal))}function Fe(m,R){if(m.match){if(m.begin||m.end)throw new Error("begin & end are not supported with match");m.begin=m.match,delete m.match}}function qe(m,R){m.relevance===void 0&&(m.relevance=1)}const yt=(m,R)=>{if(!m.beforeMatch)return;if(m.starts)throw new Error("beforeMatch cannot be used with starts");const M=Object.assign({},m);Object.keys(m).forEach(W=>{delete m[W]}),m.keywords=M.keywords,m.begin=x(M.beforeMatch,h(M.begin)),m.starts={relevance:0,contains:[Object.assign(M,{endsParent:!0})]},m.relevance=0,delete M.beforeMatch},Te=["of","and","for","in","not","or","if","then","parent","list","value"],lt="keyword";function Qe(m,R,M=lt){const W=Object.create(null);return typeof m=="string"?ve(M,m.split(" ")):Array.isArray(m)?ve(M,m):Object.keys(m).forEach(function(ge){Object.assign(W,Qe(m[ge],R,ge))}),W;function ve(ge,L){R&&(L=L.map(H=>H.toLowerCase())),L.forEach(function(H){const $=H.split("|");W[$[0]]=[ge,jt($[0],$[1])]})}}function jt(m,R){return R?Number(R):It(m)?0:1}function It(m){return Te.includes(m.toLowerCase())}const Ut={},ot=m=>{console.error(m)},ls=(m,...R)=>{console.log(`WARN: ${m}`,...R)},zt=(m,R)=>{Ut[`${m}/${R}`]||(console.log(`Deprecated as of ${m}. ${R}`),Ut[`${m}/${R}`]=!0)},Zs=new Error;function yr(m,R,{key:M}){let W=0;const ve=m[M],ge={},L={};for(let H=1;H<=R.length;H++)L[H+W]=ve[H],ge[H+W]=!0,W+=w(R[H-1]);m[M]=L,m[M]._emit=ge,m[M]._multi=!0}function mn(m){if(Array.isArray(m.begin)){if(m.skip||m.excludeBegin||m.returnBegin)throw ot("skip, excludeBegin, returnBegin not compatible with beginScope: {}"),Zs;if(typeof m.beginScope!="object"||m.beginScope===null)throw ot("beginScope must be object"),Zs;yr(m,m.begin,{key:"beginScope"}),m.begin=P(m.begin,{joinWith:""})}}function fn(m){if(Array.isArray(m.end)){if(m.skip||m.excludeEnd||m.returnEnd)throw ot("skip, excludeEnd, returnEnd not compatible with endScope: {}"),Zs;if(typeof m.endScope!="object"||m.endScope===null)throw ot("endScope must be object"),Zs;yr(m,m.end,{key:"endScope"}),m.end=P(m.end,{joinWith:""})}}function vn(m){m.scope&&typeof m.scope=="object"&&m.scope!==null&&(m.beginScope=m.scope,delete m.scope)}function gn(m){vn(m),typeof m.beginScope=="string"&&(m.beginScope={_wrap:m.beginScope}),typeof m.endScope=="string"&&(m.endScope={_wrap:m.endScope}),mn(m),fn(m)}function bn(m){function R(L,H){return new RegExp(v(L),"m"+(m.case_insensitive?"i":"")+(m.unicodeRegex?"u":"")+(H?"g":""))}class M{constructor(){this.matchIndexes={},this.regexes=[],this.matchAt=1,this.position=0}addRule(H,$){$.position=this.position++,this.matchIndexes[this.matchAt]=$,this.regexes.push([$,H]),this.matchAt+=w(H)+1}compile(){this.regexes.length===0&&(this.exec=()=>null);const H=this.regexes.map($=>$[1]);this.matcherRe=R(P(H,{joinWith:"|"}),!0),this.lastIndex=0}exec(H){this.matcherRe.lastIndex=this.lastIndex;const $=this.matcherRe.exec(H);if(!$)return null;const Ce=$.findIndex((Ns,Co)=>Co>0&&Ns!==void 0),xe=this.matchIndexes[Ce];return $.splice(0,Ce),Object.assign($,xe)}}class W{constructor(){this.rules=[],this.multiRegexes=[],this.count=0,this.lastIndex=0,this.regexIndex=0}getMatcher(H){if(this.multiRegexes[H])return this.multiRegexes[H];const $=new M;return this.rules.slice(H).forEach(([Ce,xe])=>$.addRule(Ce,xe)),$.compile(),this.multiRegexes[H]=$,$}resumingScanAtSamePosition(){return this.regexIndex!==0}considerAll(){this.regexIndex=0}addRule(H,$){this.rules.push([H,$]),$.type==="begin"&&this.count++}exec(H){const $=this.getMatcher(this.regexIndex);$.lastIndex=this.lastIndex;let Ce=$.exec(H);if(this.resumingScanAtSamePosition()&&!(Ce&&Ce.index===this.lastIndex)){const xe=this.getMatcher(0);xe.lastIndex=this.lastIndex+1,Ce=xe.exec(H)}return Ce&&(this.regexIndex+=Ce.position+1,this.regexIndex===this.count&&this.considerAll()),Ce}}function ve(L){const H=new W;return L.contains.forEach($=>H.addRule($.begin,{rule:$,type:"begin"})),L.terminatorEnd&&H.addRule(L.terminatorEnd,{type:"end"}),L.illegal&&H.addRule(L.illegal,{type:"illegal"}),H}function ge(L,H){const $=L;if(L.isCompiled)return $;[wo,Fe,gn,yt].forEach(xe=>xe(L,H)),m.compilerExtensions.forEach(xe=>xe(L,H)),L.__beforeBegin=null,[ko,Ro,qe].forEach(xe=>xe(L,H)),L.isCompiled=!0;let Ce=null;return typeof L.keywords=="object"&&L.keywords.$pattern&&(L.keywords=Object.assign({},L.keywords),Ce=L.keywords.$pattern,delete L.keywords.$pattern),Ce=Ce||/\w+/,L.keywords&&(L.keywords=Qe(L.keywords,m.case_insensitive)),$.keywordPatternRe=R(Ce,!0),H&&(L.begin||(L.begin=/\B|\b/),$.beginRe=R($.begin),!L.end&&!L.endsWithParent&&(L.end=/\B|\b/),L.end&&($.endRe=R($.end)),$.terminatorEnd=v($.end)||"",L.endsWithParent&&H.terminatorEnd&&($.terminatorEnd+=(L.end?"|":"")+H.terminatorEnd)),L.illegal&&($.illegalRe=R(L.illegal)),L.contains||(L.contains=[]),L.contains=[].concat(...L.contains.map(function(xe){return yn(xe==="self"?L:xe)})),L.contains.forEach(function(xe){ge(xe,$)}),L.starts&&ge(L.starts,H),$.matcher=ve($),$}if(m.compilerExtensions||(m.compilerExtensions=[]),m.contains&&m.contains.includes("self"))throw new Error("ERR: contains `self` is not supported at the top-level of a language.  See documentation.");return m.classNameAliases=o(m.classNameAliases||{}),ge(m)}function xr(m){return m?m.endsWithParent||xr(m.starts):!1}function yn(m){return m.variants&&!m.cachedVariants&&(m.cachedVariants=m.variants.map(function(R){return o(m,{variants:null},R)})),m.cachedVariants?m.cachedVariants:xr(m)?o(m,{starts:m.starts?o(m.starts):null}):Object.isFrozen(m)?o(m):m}var xn="11.11.1";class wn extends Error{constructor(R,M){super(R),this.name="HTMLInjectionError",this.html=M}}const _o=s,wr=o,kr=Symbol("nomatch"),kn=7,Rr=function(m){const R=Object.create(null),M=Object.create(null),W=[];let ve=!0;const ge="Could not find the language '{}', did you forget to load/include a language module?",L={disableAutodetect:!0,name:"Plain text",contains:[]};let H={ignoreUnescapedHTML:!1,throwUnescapedHTML:!1,noHighlightRe:/^(no-?highlight)$/i,languageDetectRe:/\blang(?:uage)?-([\w-]+)\b/i,classPrefix:"hljs-",cssSelector:"pre code",languages:null,__emitter:u};function $(z){return H.noHighlightRe.test(z)}function Ce(z){let B=z.className+" ";B+=z.parentNode?z.parentNode.className:"";const te=H.languageDetectRe.exec(B);if(te){const ce=Pt(te[1]);return ce||(ls(ge.replace("{}",te[1])),ls("Falling back to no-highlight mode for this block.",z)),ce?te[1]:"no-highlight"}return B.split(/\s+/).find(ce=>$(ce)||Pt(ce))}function xe(z,B,te){let ce="",ke="";typeof B=="object"?(ce=z,te=B.ignoreIllegals,ke=B.language):(zt("10.7.0","highlight(lang, code, ...args) has been deprecated."),zt("10.7.0",`Please use highlight(code, options) instead.
https://github.com/highlightjs/highlight.js/issues/2277`),ke=z,ce=B),te===void 0&&(te=!0);const rt={code:ce,language:ke};Ks("before:highlight",rt);const Nt=rt.result?rt.result:Ns(rt.language,rt.code,te);return Nt.code=rt.code,Ks("after:highlight",Nt),Nt}function Ns(z,B,te,ce){const ke=Object.create(null);function rt(D,q){return D.keywords[q]}function Nt(){if(!V.keywords){Ae.addText(le);return}let D=0;V.keywordPatternRe.lastIndex=0;let q=V.keywordPatternRe.exec(le),X="";for(;q;){X+=le.substring(D,q.index);const ae=pt.case_insensitive?q[0].toLowerCase():q[0],Me=rt(V,ae);if(Me){const[xt,qn]=Me;if(Ae.addText(X),X="",ke[ae]=(ke[ae]||0)+1,ke[ae]<=kn&&(Ys+=qn),xt.startsWith("_"))X+=q[0];else{const Bn=pt.classNameAliases[xt]||xt;dt(q[0],Bn)}}else X+=q[0];D=V.keywordPatternRe.lastIndex,q=V.keywordPatternRe.exec(le)}X+=le.substring(D),Ae.addText(X)}function Xs(){if(le==="")return;let D=null;if(typeof V.subLanguage=="string"){if(!R[V.subLanguage]){Ae.addText(le);return}D=Ns(V.subLanguage,le,!0,zr[V.subLanguage]),zr[V.subLanguage]=D._top}else D=So(le,V.subLanguage.length?V.subLanguage:null);V.relevance>0&&(Ys+=D.relevance),Ae.__addSublanguage(D._emitter,D.language)}function $e(){V.subLanguage!=null?Xs():Nt(),le=""}function dt(D,q){D!==""&&(Ae.startScope(q),Ae.addText(D),Ae.endScope())}function Tr(D,q){let X=1;const ae=q.length-1;for(;X<=ae;){if(!D._emit[X]){X++;continue}const Me=pt.classNameAliases[D[X]]||D[X],xt=q[X];Me?dt(xt,Me):(le=xt,Nt(),le=""),X++}}function Ar(D,q){return D.scope&&typeof D.scope=="string"&&Ae.openNode(pt.classNameAliases[D.scope]||D.scope),D.beginScope&&(D.beginScope._wrap?(dt(le,pt.classNameAliases[D.beginScope._wrap]||D.beginScope._wrap),le=""):D.beginScope._multi&&(Tr(D.beginScope,q),le="")),V=Object.create(D,{parent:{value:V}}),V}function Er(D,q,X){let ae=_(D.endRe,X);if(ae){if(D["on:end"]){const Me=new t(D);D["on:end"](q,Me),Me.isMatchIgnored&&(ae=!1)}if(ae){for(;D.endsParent&&D.parent;)D=D.parent;return D}}if(D.endsWithParent)return Er(D.parent,q,X)}function Mn(D){return V.matcher.regexIndex===0?(le+=D[0],1):(Io=!0,0)}function Dn(D){const q=D[0],X=D.rule,ae=new t(X),Me=[X.__beforeBegin,X["on:begin"]];for(const xt of Me)if(xt&&(xt(D,ae),ae.isMatchIgnored))return Mn(q);return X.skip?le+=q:(X.excludeBegin&&(le+=q),$e(),!X.returnBegin&&!X.excludeBegin&&(le=q)),Ar(X,D),X.returnBegin?0:q.length}function On(D){const q=D[0],X=B.substring(D.index),ae=Er(V,D,X);if(!ae)return kr;const Me=V;V.endScope&&V.endScope._wrap?($e(),dt(q,V.endScope._wrap)):V.endScope&&V.endScope._multi?($e(),Tr(V.endScope,D)):Me.skip?le+=q:(Me.returnEnd||Me.excludeEnd||(le+=q),$e(),Me.excludeEnd&&(le=q));do V.scope&&Ae.closeNode(),!V.skip&&!V.subLanguage&&(Ys+=V.relevance),V=V.parent;while(V!==ae.parent);return ae.starts&&Ar(ae.starts,D),Me.returnEnd?0:q.length}function Hn(){const D=[];for(let q=V;q!==pt;q=q.parent)q.scope&&D.unshift(q.scope);D.forEach(q=>Ae.openNode(q))}let Qs={};function Ir(D,q){const X=q&&q[0];if(le+=D,X==null)return $e(),0;if(Qs.type==="begin"&&q.type==="end"&&Qs.index===q.index&&X===""){if(le+=B.slice(q.index,q.index+1),!ve){const ae=new Error(`0 width match regex (${z})`);throw ae.languageName=z,ae.badRule=Qs.rule,ae}return 1}if(Qs=q,q.type==="begin")return Dn(q);if(q.type==="illegal"&&!te){const ae=new Error('Illegal lexeme "'+X+'" for mode "'+(V.scope||"<unnamed>")+'"');throw ae.mode=V,ae}else if(q.type==="end"){const ae=On(q);if(ae!==kr)return ae}if(q.type==="illegal"&&X==="")return le+=`
`,1;if(Eo>1e5&&Eo>q.index*3)throw new Error("potential infinite loop, way more iterations than matches");return le+=X,X.length}const pt=Pt(z);if(!pt)throw ot(ge.replace("{}",z)),new Error('Unknown language: "'+z+'"');const Ln=bn(pt);let Ao="",V=ce||Ln;const zr={},Ae=new H.__emitter(H);Hn();let le="",Ys=0,Ft=0,Eo=0,Io=!1;try{if(pt.__emitTokens)pt.__emitTokens(B,Ae);else{for(V.matcher.considerAll();;){Eo++,Io?Io=!1:V.matcher.considerAll(),V.matcher.lastIndex=Ft;const D=V.matcher.exec(B);if(!D)break;const q=B.substring(Ft,D.index),X=Ir(q,D);Ft=D.index+X}Ir(B.substring(Ft))}return Ae.finalize(),Ao=Ae.toHTML(),{language:z,value:Ao,relevance:Ys,illegal:!1,_emitter:Ae,_top:V}}catch(D){if(D.message&&D.message.includes("Illegal"))return{language:z,value:_o(B),illegal:!0,relevance:0,_illegalBy:{message:D.message,index:Ft,context:B.slice(Ft-100,Ft+100),mode:D.mode,resultSoFar:Ao},_emitter:Ae};if(ve)return{language:z,value:_o(B),illegal:!1,relevance:0,errorRaised:D,_emitter:Ae,_top:V};throw D}}function Co(z){const B={value:_o(z),illegal:!1,relevance:0,_top:L,_emitter:new H.__emitter(H)};return B._emitter.addText(z),B}function So(z,B){B=B||H.languages||Object.keys(R);const te=Co(z),ce=B.filter(Pt).filter(Sr).map($e=>Ns($e,z,!1));ce.unshift(te);const ke=ce.sort(($e,dt)=>{if($e.relevance!==dt.relevance)return dt.relevance-$e.relevance;if($e.language&&dt.language){if(Pt($e.language).supersetOf===dt.language)return 1;if(Pt(dt.language).supersetOf===$e.language)return-1}return 0}),[rt,Nt]=ke,Xs=rt;return Xs.secondBest=Nt,Xs}function Rn(z,B,te){const ce=B&&M[B]||te;z.classList.add("hljs"),z.classList.add(`language-${ce}`)}function To(z){let B=null;const te=Ce(z);if($(te))return;if(Ks("before:highlightElement",{el:z,language:te}),z.dataset.highlighted){console.log("Element previously highlighted. To highlight again, first unset `dataset.highlighted`.",z);return}if(z.children.length>0&&(H.ignoreUnescapedHTML||(console.warn("One of your code blocks includes unescaped HTML. This is a potentially serious security risk."),console.warn("https://github.com/highlightjs/highlight.js/wiki/security"),console.warn("The element with unescaped HTML:"),console.warn(z)),H.throwUnescapedHTML))throw new wn("One of your code blocks includes unescaped HTML.",z.innerHTML);B=z;const ce=B.textContent,ke=te?xe(ce,{language:te,ignoreIllegals:!0}):So(ce);z.innerHTML=ke.value,z.dataset.highlighted="yes",Rn(z,te,ke.language),z.result={language:ke.language,re:ke.relevance,relevance:ke.relevance},ke.secondBest&&(z.secondBest={language:ke.secondBest.language,relevance:ke.secondBest.relevance}),Ks("after:highlightElement",{el:z,result:ke,text:ce})}function _n(z){H=wr(H,z)}const Cn=()=>{Vs(),zt("10.6.0","initHighlighting() deprecated.  Use highlightAll() now.")};function Sn(){Vs(),zt("10.6.0","initHighlightingOnLoad() deprecated.  Use highlightAll() now.")}let _r=!1;function Vs(){function z(){Vs()}if(document.readyState==="loading"){_r||window.addEventListener("DOMContentLoaded",z,!1),_r=!0;return}document.querySelectorAll(H.cssSelector).forEach(To)}function Tn(z,B){let te=null;try{te=B(m)}catch(ce){if(ot("Language definition for '{}' could not be registered.".replace("{}",z)),ve)ot(ce);else throw ce;te=L}te.name||(te.name=z),R[z]=te,te.rawDefinition=B.bind(null,m),te.aliases&&Cr(te.aliases,{languageName:z})}function An(z){delete R[z];for(const B of Object.keys(M))M[B]===z&&delete M[B]}function En(){return Object.keys(R)}function Pt(z){return z=(z||"").toLowerCase(),R[z]||R[M[z]]}function Cr(z,{languageName:B}){typeof z=="string"&&(z=[z]),z.forEach(te=>{M[te.toLowerCase()]=B})}function Sr(z){const B=Pt(z);return B&&!B.disableAutodetect}function In(z){z["before:highlightBlock"]&&!z["before:highlightElement"]&&(z["before:highlightElement"]=B=>{z["before:highlightBlock"](Object.assign({block:B.el},B))}),z["after:highlightBlock"]&&!z["after:highlightElement"]&&(z["after:highlightElement"]=B=>{z["after:highlightBlock"](Object.assign({block:B.el},B))})}function zn(z){In(z),W.push(z)}function Pn(z){const B=W.indexOf(z);B!==-1&&W.splice(B,1)}function Ks(z,B){const te=z;W.forEach(function(ce){ce[te]&&ce[te](B)})}function Nn(z){return zt("10.7.0","highlightBlock will be removed entirely in v12.0"),zt("10.7.0","Please use highlightElement now."),To(z)}Object.assign(m,{highlight:xe,highlightAuto:So,highlightAll:Vs,highlightElement:To,highlightBlock:Nn,configure:_n,initHighlighting:Cn,initHighlightingOnLoad:Sn,registerLanguage:Tn,unregisterLanguage:An,listLanguages:En,getLanguage:Pt,registerAliases:Cr,autoDetection:Sr,inherit:wr,addPlugin:zn,removePlugin:Pn}),m.debugMode=function(){ve=!1},m.safeMode=function(){ve=!0},m.versionString=xn,m.regex={concat:x,lookahead:h,either:k,optional:y,anyNumberOfTimes:g};for(const z in ct)typeof ct[z]=="object"&&e(ct[z]);return Object.assign(m,ct),m},ds=Rr({});return ds.newInstance=()=>Rr({}),Ho=ds,ds.HighlightJS=ds,ds.default=ds,Ho}var Bl=ql();const Gt=Ll(Bl),ea="[A-Za-z$_][0-9A-Za-z$_]*",jl=["as","in","of","if","for","while","finally","var","new","function","do","return","void","else","break","catch","instanceof","with","throw","case","default","try","switch","continue","typeof","delete","let","yield","const","class","debugger","async","await","static","import","from","export","extends","using"],Ul=["true","false","null","undefined","NaN","Infinity"],on=["Object","Function","Boolean","Symbol","Math","Date","Number","BigInt","String","RegExp","Array","Float32Array","Float64Array","Int8Array","Uint8Array","Uint8ClampedArray","Int16Array","Int32Array","Uint16Array","Uint32Array","BigInt64Array","BigUint64Array","Set","Map","WeakSet","WeakMap","ArrayBuffer","SharedArrayBuffer","Atomics","DataView","JSON","Promise","Generator","GeneratorFunction","AsyncFunction","Reflect","Proxy","Intl","WebAssembly"],rn=["Error","EvalError","InternalError","RangeError","ReferenceError","SyntaxError","TypeError","URIError"],an=["setInterval","setTimeout","clearInterval","clearTimeout","require","exports","eval","isFinite","isNaN","parseFloat","parseInt","decodeURI","decodeURIComponent","encodeURI","encodeURIComponent","escape","unescape"],Fl=["arguments","this","super","console","window","document","localStorage","sessionStorage","module","global"],$l=[].concat(an,on,rn);function ta(e){const t=e.regex,s=(Y,{after:fe})=>{const _e="</"+Y[0].slice(1);return Y.input.indexOf(_e,fe)!==-1},o=ea,r={begin:"<>",end:"</>"},a=/<[A-Za-z0-9\\._:-]+\s*\/>/,i={begin:/<[A-Za-z0-9\\._:-]+/,end:/\/[A-Za-z0-9\\._:-]+>|\/>/,isTrulyOpeningTag:(Y,fe)=>{const _e=Y[0].length+Y.index,Oe=Y.input[_e];if(Oe==="<"||Oe===","){fe.ignoreMatch();return}Oe===">"&&(s(Y,{after:_e})||fe.ignoreMatch());let Le;const Xe=Y.input.substring(_e);if(Le=Xe.match(/^\s*=/)){fe.ignoreMatch();return}if((Le=Xe.match(/^\s+extends\s+/))&&Le.index===0){fe.ignoreMatch();return}}},c={$pattern:ea,keyword:jl,literal:Ul,built_in:$l,"variable.language":Fl},l="[0-9](_?[0-9])*",d=`\\.(${l})`,u="0|[1-9](_?[0-9])*|0[0-7]*[89][0-9]*",v={className:"number",variants:[{begin:`(\\b(${u})((${d})|\\.)?|(${d}))[eE][+-]?(${l})\\b`},{begin:`\\b(${u})\\b((${d})\\b|\\.)?|(${d})\\b`},{begin:"\\b(0|[1-9](_?[0-9])*)n\\b"},{begin:"\\b0[xX][0-9a-fA-F](_?[0-9a-fA-F])*n?\\b"},{begin:"\\b0[bB][0-1](_?[0-1])*n?\\b"},{begin:"\\b0[oO][0-7](_?[0-7])*n?\\b"},{begin:"\\b0[0-7]+n?\\b"}],relevance:0},h={className:"subst",begin:"\\$\\{",end:"\\}",keywords:c,contains:[]},g={begin:".?html`",end:"",starts:{end:"`",returnEnd:!1,contains:[e.BACKSLASH_ESCAPE,h],subLanguage:"xml"}},y={begin:".?css`",end:"",starts:{end:"`",returnEnd:!1,contains:[e.BACKSLASH_ESCAPE,h],subLanguage:"css"}},x={begin:".?gql`",end:"",starts:{end:"`",returnEnd:!1,contains:[e.BACKSLASH_ESCAPE,h],subLanguage:"graphql"}},b={className:"string",begin:"`",end:"`",contains:[e.BACKSLASH_ESCAPE,h]},w={className:"comment",variants:[e.COMMENT(/\/\*\*(?!\/)/,"\\*/",{relevance:0,contains:[{begin:"(?=@[A-Za-z]+)",relevance:0,contains:[{className:"doctag",begin:"@[A-Za-z]+"},{className:"type",begin:"\\{",end:"\\}",excludeEnd:!0,excludeBegin:!0,relevance:0},{className:"variable",begin:o+"(?=\\s*(-)|$)",endsParent:!0,relevance:0},{begin:/(?=[^\n])\s/,relevance:0}]}]}),e.C_BLOCK_COMMENT_MODE,e.C_LINE_COMMENT_MODE]},_=[e.APOS_STRING_MODE,e.QUOTE_STRING_MODE,g,y,x,b,{match:/\$\d+/},v];h.contains=_.concat({begin:/\{/,end:/\}/,keywords:c,contains:["self"].concat(_)});const S=[].concat(w,h.contains),P=S.concat([{begin:/(\s*)\(/,end:/\)/,keywords:c,contains:["self"].concat(S)}]),I={className:"params",begin:/(\s*)\(/,end:/\)/,excludeBegin:!0,excludeEnd:!0,keywords:c,contains:P},T={variants:[{match:[/class/,/\s+/,o,/\s+/,/extends/,/\s+/,t.concat(o,"(",t.concat(/\./,o),")*")],scope:{1:"keyword",3:"title.class",5:"keyword",7:"title.class.inherited"}},{match:[/class/,/\s+/,o],scope:{1:"keyword",3:"title.class"}}]},A={relevance:0,match:t.either(/\bJSON/,/\b[A-Z][a-z]+([A-Z][a-z]*|\d)*/,/\b[A-Z]{2,}([A-Z][a-z]+|\d)+([A-Z][a-z]*)*/,/\b[A-Z]{2,}[a-z]+([A-Z][a-z]+|\d)*([A-Z][a-z]*)*/),className:"title.class",keywords:{_:[...on,...rn]}},O={label:"use_strict",className:"meta",relevance:10,begin:/^\s*['"]use (strict|asm)['"]/},Z={variants:[{match:[/function/,/\s+/,o,/(?=\s*\()/]},{match:[/function/,/\s*(?=\()/]}],className:{1:"keyword",3:"title.function"},label:"func.def",contains:[I],illegal:/%/},K={relevance:0,match:/\b[A-Z][A-Z_0-9]+\b/,className:"variable.constant"};function J(Y){return t.concat("(?!",Y.join("|"),")")}const ye={match:t.concat(/\b/,J([...an,"super","import"].map(Y=>`${Y}\\s*\\(`)),o,t.lookahead(/\s*\(/)),className:"title.function",relevance:0},oe={begin:t.concat(/\./,t.lookahead(t.concat(o,/(?![0-9A-Za-z$_(])/))),end:o,excludeBegin:!0,keywords:"prototype",className:"property",relevance:0},ie={match:[/get|set/,/\s+/,o,/(?=\()/],className:{1:"keyword",3:"title.function"},contains:[{begin:/\(\)/},I]},Re="(\\([^()]*(\\([^()]*(\\([^()]*\\)[^()]*)*\\)[^()]*)*\\)|"+e.UNDERSCORE_IDENT_RE+")\\s*=>",it={match:[/const|var|let/,/\s+/,o,/\s*/,/=\s*/,/(async\s*)?/,t.lookahead(Re)],keywords:"async",className:{1:"keyword",3:"title.function"},contains:[I]};return{name:"JavaScript",aliases:["js","jsx","mjs","cjs"],keywords:c,exports:{PARAMS_CONTAINS:P,CLASS_REFERENCE:A},illegal:/#(?![$_A-z])/,contains:[e.SHEBANG({label:"shebang",binary:"node",relevance:5}),O,e.APOS_STRING_MODE,e.QUOTE_STRING_MODE,g,y,x,b,w,{match:/\$\d+/},v,A,{scope:"attr",match:o+t.lookahead(":"),relevance:0},it,{begin:"("+e.RE_STARTERS_RE+"|\\b(case|return|throw)\\b)\\s*",keywords:"return throw case",relevance:0,contains:[w,e.REGEXP_MODE,{className:"function",begin:Re,returnBegin:!0,end:"\\s*=>",contains:[{className:"params",variants:[{begin:e.UNDERSCORE_IDENT_RE,relevance:0},{className:null,begin:/\(\s*\)/,skip:!0},{begin:/(\s*)\(/,end:/\)/,excludeBegin:!0,excludeEnd:!0,keywords:c,contains:P}]}]},{begin:/,/,relevance:0},{match:/\s+/,relevance:0},{variants:[{begin:r.begin,end:r.end},{match:a},{begin:i.begin,"on:begin":i.isTrulyOpeningTag,end:i.end}],subLanguage:"xml",contains:[{begin:i.begin,end:i.end,skip:!0,contains:["self"]}]}]},Z,{beginKeywords:"while if switch catch for"},{begin:"\\b(?!function)"+e.UNDERSCORE_IDENT_RE+"\\([^()]*(\\([^()]*(\\([^()]*\\)[^()]*)*\\)[^()]*)*\\)\\s*\\{",returnBegin:!0,label:"func.def",contains:[I,e.inherit(e.TITLE_MODE,{begin:o,className:"title.function"})]},{match:/\.\.\./,relevance:0},oe,{match:"\\$"+o,relevance:0},{match:[/\bconstructor(?=\s*\()/],className:{1:"title.function"},contains:[I]},ye,K,T,ie,{match:/\$[(.]/}]}}const ho="[A-Za-z$_][0-9A-Za-z$_]*",nn=["as","in","of","if","for","while","finally","var","new","function","do","return","void","else","break","catch","instanceof","with","throw","case","default","try","switch","continue","typeof","delete","let","yield","const","class","debugger","async","await","static","import","from","export","extends","using"],cn=["true","false","null","undefined","NaN","Infinity"],ln=["Object","Function","Boolean","Symbol","Math","Date","Number","BigInt","String","RegExp","Array","Float32Array","Float64Array","Int8Array","Uint8Array","Uint8ClampedArray","Int16Array","Int32Array","Uint16Array","Uint32Array","BigInt64Array","BigUint64Array","Set","Map","WeakSet","WeakMap","ArrayBuffer","SharedArrayBuffer","Atomics","DataView","JSON","Promise","Generator","GeneratorFunction","AsyncFunction","Reflect","Proxy","Intl","WebAssembly"],dn=["Error","EvalError","InternalError","RangeError","ReferenceError","SyntaxError","TypeError","URIError"],pn=["setInterval","setTimeout","clearInterval","clearTimeout","require","exports","eval","isFinite","isNaN","parseFloat","parseInt","decodeURI","decodeURIComponent","encodeURI","encodeURIComponent","escape","unescape"],un=["arguments","this","super","console","window","document","localStorage","sessionStorage","module","global"],hn=[].concat(pn,ln,dn);function Gl(e){const t=e.regex,s=(Y,{after:fe})=>{const _e="</"+Y[0].slice(1);return Y.input.indexOf(_e,fe)!==-1},o=ho,r={begin:"<>",end:"</>"},a=/<[A-Za-z0-9\\._:-]+\s*\/>/,i={begin:/<[A-Za-z0-9\\._:-]+/,end:/\/[A-Za-z0-9\\._:-]+>|\/>/,isTrulyOpeningTag:(Y,fe)=>{const _e=Y[0].length+Y.index,Oe=Y.input[_e];if(Oe==="<"||Oe===","){fe.ignoreMatch();return}Oe===">"&&(s(Y,{after:_e})||fe.ignoreMatch());let Le;const Xe=Y.input.substring(_e);if(Le=Xe.match(/^\s*=/)){fe.ignoreMatch();return}if((Le=Xe.match(/^\s+extends\s+/))&&Le.index===0){fe.ignoreMatch();return}}},c={$pattern:ho,keyword:nn,literal:cn,built_in:hn,"variable.language":un},l="[0-9](_?[0-9])*",d=`\\.(${l})`,u="0|[1-9](_?[0-9])*|0[0-7]*[89][0-9]*",v={className:"number",variants:[{begin:`(\\b(${u})((${d})|\\.)?|(${d}))[eE][+-]?(${l})\\b`},{begin:`\\b(${u})\\b((${d})\\b|\\.)?|(${d})\\b`},{begin:"\\b(0|[1-9](_?[0-9])*)n\\b"},{begin:"\\b0[xX][0-9a-fA-F](_?[0-9a-fA-F])*n?\\b"},{begin:"\\b0[bB][0-1](_?[0-1])*n?\\b"},{begin:"\\b0[oO][0-7](_?[0-7])*n?\\b"},{begin:"\\b0[0-7]+n?\\b"}],relevance:0},h={className:"subst",begin:"\\$\\{",end:"\\}",keywords:c,contains:[]},g={begin:".?html`",end:"",starts:{end:"`",returnEnd:!1,contains:[e.BACKSLASH_ESCAPE,h],subLanguage:"xml"}},y={begin:".?css`",end:"",starts:{end:"`",returnEnd:!1,contains:[e.BACKSLASH_ESCAPE,h],subLanguage:"css"}},x={begin:".?gql`",end:"",starts:{end:"`",returnEnd:!1,contains:[e.BACKSLASH_ESCAPE,h],subLanguage:"graphql"}},b={className:"string",begin:"`",end:"`",contains:[e.BACKSLASH_ESCAPE,h]},w={className:"comment",variants:[e.COMMENT(/\/\*\*(?!\/)/,"\\*/",{relevance:0,contains:[{begin:"(?=@[A-Za-z]+)",relevance:0,contains:[{className:"doctag",begin:"@[A-Za-z]+"},{className:"type",begin:"\\{",end:"\\}",excludeEnd:!0,excludeBegin:!0,relevance:0},{className:"variable",begin:o+"(?=\\s*(-)|$)",endsParent:!0,relevance:0},{begin:/(?=[^\n])\s/,relevance:0}]}]}),e.C_BLOCK_COMMENT_MODE,e.C_LINE_COMMENT_MODE]},_=[e.APOS_STRING_MODE,e.QUOTE_STRING_MODE,g,y,x,b,{match:/\$\d+/},v];h.contains=_.concat({begin:/\{/,end:/\}/,keywords:c,contains:["self"].concat(_)});const S=[].concat(w,h.contains),P=S.concat([{begin:/(\s*)\(/,end:/\)/,keywords:c,contains:["self"].concat(S)}]),I={className:"params",begin:/(\s*)\(/,end:/\)/,excludeBegin:!0,excludeEnd:!0,keywords:c,contains:P},T={variants:[{match:[/class/,/\s+/,o,/\s+/,/extends/,/\s+/,t.concat(o,"(",t.concat(/\./,o),")*")],scope:{1:"keyword",3:"title.class",5:"keyword",7:"title.class.inherited"}},{match:[/class/,/\s+/,o],scope:{1:"keyword",3:"title.class"}}]},A={relevance:0,match:t.either(/\bJSON/,/\b[A-Z][a-z]+([A-Z][a-z]*|\d)*/,/\b[A-Z]{2,}([A-Z][a-z]+|\d)+([A-Z][a-z]*)*/,/\b[A-Z]{2,}[a-z]+([A-Z][a-z]+|\d)*([A-Z][a-z]*)*/),className:"title.class",keywords:{_:[...ln,...dn]}},O={label:"use_strict",className:"meta",relevance:10,begin:/^\s*['"]use (strict|asm)['"]/},Z={variants:[{match:[/function/,/\s+/,o,/(?=\s*\()/]},{match:[/function/,/\s*(?=\()/]}],className:{1:"keyword",3:"title.function"},label:"func.def",contains:[I],illegal:/%/},K={relevance:0,match:/\b[A-Z][A-Z_0-9]+\b/,className:"variable.constant"};function J(Y){return t.concat("(?!",Y.join("|"),")")}const ye={match:t.concat(/\b/,J([...pn,"super","import"].map(Y=>`${Y}\\s*\\(`)),o,t.lookahead(/\s*\(/)),className:"title.function",relevance:0},oe={begin:t.concat(/\./,t.lookahead(t.concat(o,/(?![0-9A-Za-z$_(])/))),end:o,excludeBegin:!0,keywords:"prototype",className:"property",relevance:0},ie={match:[/get|set/,/\s+/,o,/(?=\()/],className:{1:"keyword",3:"title.function"},contains:[{begin:/\(\)/},I]},Re="(\\([^()]*(\\([^()]*(\\([^()]*\\)[^()]*)*\\)[^()]*)*\\)|"+e.UNDERSCORE_IDENT_RE+")\\s*=>",it={match:[/const|var|let/,/\s+/,o,/\s*/,/=\s*/,/(async\s*)?/,t.lookahead(Re)],keywords:"async",className:{1:"keyword",3:"title.function"},contains:[I]};return{name:"JavaScript",aliases:["js","jsx","mjs","cjs"],keywords:c,exports:{PARAMS_CONTAINS:P,CLASS_REFERENCE:A},illegal:/#(?![$_A-z])/,contains:[e.SHEBANG({label:"shebang",binary:"node",relevance:5}),O,e.APOS_STRING_MODE,e.QUOTE_STRING_MODE,g,y,x,b,w,{match:/\$\d+/},v,A,{scope:"attr",match:o+t.lookahead(":"),relevance:0},it,{begin:"("+e.RE_STARTERS_RE+"|\\b(case|return|throw)\\b)\\s*",keywords:"return throw case",relevance:0,contains:[w,e.REGEXP_MODE,{className:"function",begin:Re,returnBegin:!0,end:"\\s*=>",contains:[{className:"params",variants:[{begin:e.UNDERSCORE_IDENT_RE,relevance:0},{className:null,begin:/\(\s*\)/,skip:!0},{begin:/(\s*)\(/,end:/\)/,excludeBegin:!0,excludeEnd:!0,keywords:c,contains:P}]}]},{begin:/,/,relevance:0},{match:/\s+/,relevance:0},{variants:[{begin:r.begin,end:r.end},{match:a},{begin:i.begin,"on:begin":i.isTrulyOpeningTag,end:i.end}],subLanguage:"xml",contains:[{begin:i.begin,end:i.end,skip:!0,contains:["self"]}]}]},Z,{beginKeywords:"while if switch catch for"},{begin:"\\b(?!function)"+e.UNDERSCORE_IDENT_RE+"\\([^()]*(\\([^()]*(\\([^()]*\\)[^()]*)*\\)[^()]*)*\\)\\s*\\{",returnBegin:!0,label:"func.def",contains:[I,e.inherit(e.TITLE_MODE,{begin:o,className:"title.function"})]},{match:/\.\.\./,relevance:0},oe,{match:"\\$"+o,relevance:0},{match:[/\bconstructor(?=\s*\()/],className:{1:"title.function"},contains:[I]},ye,K,T,ie,{match:/\$[(.]/}]}}function sa(e){const t=e.regex,s=Gl(e),o=ho,r=["any","void","number","boolean","string","object","never","symbol","bigint","unknown"],a={begin:[/namespace/,/\s+/,e.IDENT_RE],beginScope:{1:"keyword",3:"title.class"}},i={beginKeywords:"interface",end:/\{/,excludeEnd:!0,keywords:{keyword:"interface extends",built_in:r},contains:[s.exports.CLASS_REFERENCE]},c={className:"meta",relevance:10,begin:/^\s*['"]use strict['"]/},l=["type","interface","public","private","protected","implements","declare","abstract","readonly","enum","override","satisfies"],d={$pattern:ho,keyword:nn.concat(l),literal:cn,built_in:hn.concat(r),"variable.language":un},u={className:"meta",begin:"@"+o},v=(x,b,k)=>{const w=x.contains.findIndex(_=>_.label===b);if(w===-1)throw new Error("can not find mode to replace");x.contains.splice(w,1,k)};Object.assign(s.keywords,d),s.exports.PARAMS_CONTAINS.push(u);const h=s.contains.find(x=>x.scope==="attr"),g=Object.assign({},h,{match:t.concat(o,t.lookahead(/\s*\?:/))});s.exports.PARAMS_CONTAINS.push([s.exports.CLASS_REFERENCE,h,g]),s.contains=s.contains.concat([u,a,i,g]),v(s,"shebang",e.SHEBANG()),v(s,"use_strict",c);const y=s.contains.find(x=>x.label==="func.def");return y.relevance=0,Object.assign(s,{name:"TypeScript",aliases:["ts","tsx","mts","cts"]}),s}function Jl(e){const t=e.regex,s={},o={begin:/\$\{/,end:/\}/,contains:["self",{begin:/:-/,contains:[s]}]};Object.assign(s,{className:"variable",variants:[{begin:t.concat(/\$[\w\d#@][\w\d_]*/,"(?![\\w\\d])(?![$])")},o]});const r={className:"subst",begin:/\$\(/,end:/\)/,contains:[e.BACKSLASH_ESCAPE]},a=e.inherit(e.COMMENT(),{match:[/(^|\s)/,/#.*$/],scope:{2:"comment"}}),i={begin:/<<-?\s*(?=\w+)/,starts:{contains:[e.END_SAME_AS_BEGIN({begin:/(\w+)/,end:/(\w+)/,className:"string"})]}},c={className:"string",begin:/"/,end:/"/,contains:[e.BACKSLASH_ESCAPE,s,r]};r.contains.push(c);const l={match:/\\"/},d={className:"string",begin:/'/,end:/'/},u={match:/\\'/},v={begin:/\$?\(\(/,end:/\)\)/,contains:[{begin:/\d+#[0-9a-f]+/,className:"number"},e.NUMBER_MODE,s]},h=["fish","bash","zsh","sh","csh","ksh","tcsh","dash","scsh"],g=e.SHEBANG({binary:`(${h.join("|")})`,relevance:10}),y={className:"function",begin:/\w[\w\d_]*\s*\(\s*\)\s*\{/,returnBegin:!0,contains:[e.inherit(e.TITLE_MODE,{begin:/\w[\w\d_]*/})],relevance:0},x=["if","then","else","elif","fi","time","for","while","until","in","do","done","case","esac","coproc","function","select"],b=["true","false"],k={match:/(\/[a-z._-]+)+/},w=["break","cd","continue","eval","exec","exit","export","getopts","hash","pwd","readonly","return","shift","test","times","trap","umask","unset"],_=["alias","bind","builtin","caller","command","declare","echo","enable","help","let","local","logout","mapfile","printf","read","readarray","source","sudo","type","typeset","ulimit","unalias"],S=["autoload","bg","bindkey","bye","cap","chdir","clone","comparguments","compcall","compctl","compdescribe","compfiles","compgroups","compquote","comptags","comptry","compvalues","dirs","disable","disown","echotc","echoti","emulate","fc","fg","float","functions","getcap","getln","history","integer","jobs","kill","limit","log","noglob","popd","print","pushd","pushln","rehash","sched","setcap","setopt","stat","suspend","ttyctl","unfunction","unhash","unlimit","unsetopt","vared","wait","whence","where","which","zcompile","zformat","zftp","zle","zmodload","zparseopts","zprof","zpty","zregexparse","zsocket","zstyle","ztcp"],P=["chcon","chgrp","chown","chmod","cp","dd","df","dir","dircolors","ln","ls","mkdir","mkfifo","mknod","mktemp","mv","realpath","rm","rmdir","shred","sync","touch","truncate","vdir","b2sum","base32","base64","cat","cksum","comm","csplit","cut","expand","fmt","fold","head","join","md5sum","nl","numfmt","od","paste","ptx","pr","sha1sum","sha224sum","sha256sum","sha384sum","sha512sum","shuf","sort","split","sum","tac","tail","tr","tsort","unexpand","uniq","wc","arch","basename","chroot","date","dirname","du","echo","env","expr","factor","groups","hostid","id","link","logname","nice","nohup","nproc","pathchk","pinky","printenv","printf","pwd","readlink","runcon","seq","sleep","stat","stdbuf","stty","tee","test","timeout","tty","uname","unlink","uptime","users","who","whoami","yes"];return{name:"Bash",aliases:["sh","zsh"],keywords:{$pattern:/\b[a-z][a-z0-9._-]+\b/,keyword:x,literal:b,built_in:[...w,..._,"set","shopt",...S,...P]},contains:[g,e.SHEBANG(),y,v,a,i,k,c,l,d,u,s]}}function Wl(e){const t={className:"attr",begin:/"(\\.|[^\\"\r\n])*"(?=\s*:)/,relevance:1.01},s={match:/[{}[\],:]/,className:"punctuation",relevance:0},o=["true","false","null"],r={scope:"literal",beginKeywords:o.join(" ")};return{name:"JSON",aliases:["jsonc"],keywords:{literal:o},contains:[t,s,e.QUOTE_STRING_MODE,r,e.C_NUMBER_MODE,e.C_LINE_COMMENT_MODE,e.C_BLOCK_COMMENT_MODE],illegal:"\\S"}}var Zl=as('<svg class="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> Copied!',1),Vl=as('<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg> Copy',1),Kl=N('<div class="flex items-center justify-between px-4 py-2 border-b" style="border-color: var(--border);"><span class="text-sm font-mono" style="color: var(--muted);"> </span> <button class="flex items-center gap-1.5 text-xs px-2 py-1 rounded hover:bg-[var(--border)] transition-colors cursor-pointer" style="color: var(--muted);"><!></button></div>'),Xl=as('<svg class="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>'),Ql=as('<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>'),Yl=N('<button class="absolute top-2 right-2 flex items-center gap-1.5 text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer" style="background-color: var(--border); color: var(--muted);"><!></button>'),ed=N('<td class="select-none text-right pr-4 pl-4 py-0 align-top svelte-1e06m8e" style="color: var(--muted); width: 1%; white-space: nowrap;"></td>'),td=N('<tr><!><td class="py-0 pr-4 svelte-1e06m8e" style="white-space: pre;"><!></td></tr>'),sd=N('<div class="code-block my-4 overflow-hidden svelte-1e06m8e"><!> <div class="relative group"><!> <div class="overflow-x-auto"><table class="w-full text-sm svelte-1e06m8e" style="border-collapse: collapse;"><tbody></tbody></table></div></div></div>');function f(e,t){he(t,!1);const s=Ke();Gt.registerLanguage("javascript",ta),Gt.registerLanguage("typescript",sa),Gt.registerLanguage("bash",Jl),Gt.registerLanguage("json",Wl),Gt.registerLanguage("js",ta),Gt.registerLanguage("ts",sa);let o=Zt(t,"code",8),r=Zt(t,"language",8,"typescript"),a=Zt(t,"filename",8,""),i=Zt(t,"showLineNumbers",8,!0),c=Ke(!1),l=Ke([]);xo(()=>{const S=o().trim().split(`
`);de(l,S.map(P=>{try{return Gt.highlight(P||" ",{language:r()}).value}catch{return P||" "}}))});async function d(){await navigator.clipboard.writeText(o().trim()),de(c,!0),setTimeout(()=>de(c,!1),2e3)}qs(()=>Ua(o()),()=>{de(s,o().trim().split(`
`))}),mr(),we();var u=sd(),v=p(u);{var h=_=>{var S=Kl(),P=p(S),I=p(P),T=n(P,2),A=p(T);{var O=K=>{var J=Zl();E(K,J)},Z=K=>{var J=Vl();E(K,J)};Ze(A,K=>{C(c)?K(O):K(Z,!1)})}pe(()=>Q(I,a())),ee("click",T,d),E(_,S)};Ze(v,_=>{a()&&_(h)})}var g=n(v,2),y=p(g);{var x=_=>{var S=Yl(),P=p(S);{var I=A=>{var O=Xl();E(A,O)},T=A=>{var O=Ql();E(A,O)};Ze(P,A=>{C(c)?A(I):A(T,!1)})}ee("click",S,d),E(_,S)};Ze(y,_=>{a()||_(x)})}var b=n(y,2),k=p(b),w=p(k);ze(w,5,()=>C(s),Ie,(_,S,P)=>{var I=td(),T=p(I);{var A=K=>{var J=ed();J.textContent=P+1,E(K,J)};Ze(T,K=>{i()&&K(A)})}var O=n(T),Z=p(O);ac(Z,()=>(C(l),C(S),Se(()=>C(l)[P]||C(S)||" "))),E(_,I)}),E(e,u),me()}const oa={BASE_URL:"/",DEV:!1,MODE:"production",PROD:!0,SSR:!1,VITE_ADAPTER_COUNT:"7",VITE_DEPENDENCY_COUNT:"7",VITE_DESCRIPTION:"Lightning-fast, enterprise-grade HTTP client for modern JavaScript. Full HTTP/2 support, intelligent cookie management, multiple adapters (HTTP, Fetch, cURL, XHR), streaming, proxy support (HTTP/HTTPS/SOCKS), and cross-environment compatibility.",VITE_LICENSE:"MIT",VITE_MIN_NODE_VERSION:"22.0.0",VITE_PACKAGE_VERSION:"1.0.15",VITE_REPOSITORY:"https://github.com/yuniqsolutions/rezo",VITE_RUNTIME_COUNT:"6"},Ot=(e,t)=>typeof import.meta<"u"&&oa&&oa[e]||t,hs={version:Ot("VITE_PACKAGE_VERSION","1.0.0"),adapterCount:parseInt(Ot("VITE_ADAPTER_COUNT","6"),10),dependencyCount:parseInt(Ot("VITE_DEPENDENCY_COUNT","0"),10),typesCoverage:"100%",runtimeCount:parseInt(Ot("VITE_RUNTIME_COUNT","6"),10),description:Ot("VITE_DESCRIPTION","Enterprise-grade HTTP client for JavaScript"),repository:Ot("VITE_REPOSITORY","https://github.com/yuniqsolutions/rezo"),license:Ot("VITE_LICENSE","MIT"),minNodeVersion:Ot("VITE_MIN_NODE_VERSION","22.0.0")};var od=N('<div class="text-center stat-item svelte-3qd30r"><div class="text-4xl sm:text-5xl font-bold gradient-text-animated mb-2 stat-value svelte-3qd30r"> </div> <div style="color: var(--muted);" class="svelte-3qd30r"> </div></div>'),rd=N('<div class="feature-card svelte-3qd30r"><div class="feature-card-inner svelte-3qd30r"><div class="feature-glow svelte-3qd30r"></div> <div class="text-4xl mb-4 feature-icon svelte-3qd30r"> </div> <h3 class="text-xl font-semibold mb-2 svelte-3qd30r"> </h3> <p style="color: var(--muted);" class="svelte-3qd30r"> </p></div></div>'),ad=N('<div class="adapter-card svelte-3qd30r"><div class="adapter-card-border svelte-3qd30r"></div> <div class="adapter-card-inner svelte-3qd30r"><div class="text-3xl adapter-icon svelte-3qd30r"> </div> <div class="svelte-3qd30r"><h3 class="font-semibold mb-1 svelte-3qd30r"> </h3> <p class="text-sm svelte-3qd30r" style="color: var(--muted);"> </p></div></div></div>'),nd=N('<div class="runtime-tag svelte-3qd30r"><span class="runtime-tag-glow svelte-3qd30r"></span> <span class="relative z-10 svelte-3qd30r"> </span></div>'),id=N(`<div class="min-h-screen landing-page svelte-3qd30r" style="background-color: var(--bg); color: var(--text);"><section class="relative overflow-hidden pt-32 pb-20 lg:pt-40 lg:pb-32 svelte-3qd30r"><div class="absolute inset-0 overflow-hidden pointer-events-none svelte-3qd30r"><div class="floating-orb orb-1 svelte-3qd30r"></div> <div class="floating-orb orb-2 svelte-3qd30r"></div> <div class="floating-orb orb-3 svelte-3qd30r"></div> <div class="grid-bg svelte-3qd30r"></div></div> <div class="relative max-w-6xl mx-auto px-4 sm:px-6 svelte-3qd30r"><div class="text-center mb-12 svelte-3qd30r"><div><span class="w-2 h-2 rounded-full bg-green-500 pulse-glow svelte-3qd30r"></span> <span style="color: var(--muted);" class="svelte-3qd30r"> </span></div> <h1>The <span class="gradient-text-animated svelte-3qd30r">Modern</span> HTTP Client<br class="svelte-3qd30r"/> for JavaScript</h1> <p style="color: var(--muted);"> </p> <div><button class="cta-button primary svelte-3qd30r"><span class="cta-glow svelte-3qd30r"></span> <span class="relative z-10 svelte-3qd30r">Get Started</span></button> <button class="cta-button secondary svelte-3qd30r">View Examples</button></div> <div style="color: var(--muted);"><code class="install-code svelte-3qd30r"><span class="shimmer-overlay svelte-3qd30r"></span> npm install rezo</code> <span class="svelte-3qd30r">or</span> <code class="install-code svelte-3qd30r"><span class="shimmer-overlay svelte-3qd30r"></span> bun add rezo</code></div></div> <div><div class="code-wrapper svelte-3qd30r"><!></div></div></div></section> <section class="py-16 border-y stats-section svelte-3qd30r" style="border-color: var(--border);"><div class="max-w-6xl mx-auto px-4 sm:px-6 svelte-3qd30r"><div class="grid grid-cols-2 md:grid-cols-4 gap-8 svelte-3qd30r"></div> <p class="text-center text-sm mt-6 svelte-3qd30r" style="color: var(--muted);">Minimal runtime dependencies for proxy support, cookies, and streaming.</p></div></section> <section class="py-20 lg:py-32 features-section svelte-3qd30r"><div class="max-w-6xl mx-auto px-4 sm:px-6 svelte-3qd30r"><div class="text-center mb-16 svelte-3qd30r"><h2 class="text-3xl sm:text-4xl font-bold mb-4 section-title svelte-3qd30r">Everything You <span class="gradient-text-animated svelte-3qd30r">Need</span></h2> <p class="text-lg max-w-2xl mx-auto svelte-3qd30r" style="color: var(--muted);">Built for developers who demand the best. Rezo provides all the tools you need
          for robust HTTP communication.</p></div> <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 svelte-3qd30r"></div></div></section> <section class="py-20 lg:py-32 adapters-section svelte-3qd30r" style="background-color: var(--surface);"><div class="max-w-6xl mx-auto px-4 sm:px-6 svelte-3qd30r"><div class="text-center mb-16 svelte-3qd30r"><h2 class="text-3xl sm:text-4xl font-bold mb-4 section-title svelte-3qd30r">One Library, <span class="gradient-text-animated svelte-3qd30r">Six Adapters</span></h2> <p class="text-lg max-w-2xl mx-auto svelte-3qd30r" style="color: var(--muted);">Choose the right adapter for your environment. Rezo automatically selects the best one,
          or you can import exactly what you need.</p></div> <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 svelte-3qd30r"></div></div></section> <section class="py-20 lg:py-32 runtimes-section svelte-3qd30r"><div class="max-w-6xl mx-auto px-4 sm:px-6 svelte-3qd30r"><div class="text-center mb-16 svelte-3qd30r"><h2 class="text-3xl sm:text-4xl font-bold mb-4 section-title svelte-3qd30r">Works <span class="gradient-text-animated svelte-3qd30r">Everywhere</span></h2> <p class="text-lg max-w-2xl mx-auto svelte-3qd30r" style="color: var(--muted);">From Node.js servers to browser apps, from React Native to edge functions.
          Rezo runs wherever JavaScript runs.</p></div> <div class="flex flex-wrap justify-center gap-4 text-center svelte-3qd30r"></div></div></section> <section class="py-20 lg:py-32 border-t cta-section svelte-3qd30r" style="border-color: var(--border); background: linear-gradient(180deg, var(--surface) 0%, var(--bg) 100%);"><div class="max-w-4xl mx-auto px-4 sm:px-6 text-center svelte-3qd30r"><div class="cta-glow-bg svelte-3qd30r"></div> <h2 class="text-3xl sm:text-4xl font-bold mb-6 section-title relative z-10 svelte-3qd30r">Ready to <span class="gradient-text-animated svelte-3qd30r">Get Started</span>?</h2> <p class="text-lg mb-10 relative z-10 svelte-3qd30r" style="color: var(--muted);">Join developers who have already made the switch to Rezo.
        It takes less than a minute to get started.</p> <div class="flex flex-wrap items-center justify-center gap-4 relative z-10 svelte-3qd30r"><button class="cta-button primary large svelte-3qd30r"><span class="cta-glow svelte-3qd30r"></span> <span class="relative z-10 svelte-3qd30r">Read the Docs</span></button> <a href="https://github.com/yuniqsolutions/rezo" target="_blank" rel="noopener" class="cta-button secondary large flex items-center gap-2 svelte-3qd30r"><svg class="w-5 h-5 svelte-3qd30r" fill="currentColor" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clip-rule="evenodd" class="svelte-3qd30r"></path></svg> GitHub</a></div></div></section> <footer class="py-8 border-t svelte-3qd30r" style="border-color: var(--border);"><div class="max-w-6xl mx-auto px-4 sm:px-6 svelte-3qd30r"><div class="flex flex-col sm:flex-row items-center justify-between gap-4 svelte-3qd30r"><p style="color: var(--muted);" class="svelte-3qd30r">Built with care for the JavaScript community</p> <div class="flex items-center gap-6 svelte-3qd30r" style="color: var(--muted);"><a href="#/docs" class="footer-link cursor-pointer svelte-3qd30r">Docs</a> <a href="https://github.com/yuniqsolutions/rezo" target="_blank" rel="noopener" class="footer-link cursor-pointer svelte-3qd30r">GitHub</a> <a href="https://npmjs.com/package/rezo" target="_blank" rel="noopener" class="footer-link cursor-pointer svelte-3qd30r">npm</a></div></div></div></footer></div>`);function ra(e,t){he(t,!1);let s=Ke(!1),o=Ke(0);xo(()=>{de(s,!0);const Fe=()=>de(o,window.scrollY);return window.addEventListener("scroll",Fe),()=>window.removeEventListener("scroll",Fe)});const r=`import rezo from 'rezo';

// Simple and intuitive API
const { data } = await rezo.get('https://api.example.com/users');

// Full TypeScript support
const user = await rezo.post<User>('/users', {
  name: 'John Doe',
  email: 'john@example.com'
});`,a=[{icon:"⚡",title:"Lightning Fast",description:"HTTP/2 with session pooling and multiplexing for maximum performance."},{icon:"🔌",title:`${hs.adapterCount} Adapters`,description:"HTTP, HTTP/2, Fetch, cURL, XHR, and React Native adapters."},{icon:"🍪",title:"Smart Cookies",description:"Automatic cookie management with tough-cookie integration."},{icon:"🔄",title:"Retry Logic",description:"Exponential backoff with customizable retry strategies."},{icon:"🌐",title:"Proxy Support",description:"HTTP, HTTPS, SOCKS4/5 with rotation and health checking."},{icon:"📦",title:"Tree-Shakeable",description:"Import only what you need for optimal bundle size."}],i=[{value:String(hs.adapterCount),label:"Adapters"},{value:hs.typesCoverage,label:"TypeScript"},{value:String(hs.dependencyCount),label:"Dependencies"},{value:"∞",label:"Possibilities"}],c=[{name:"HTTP",desc:"Full-featured Node.js adapter",icon:"🌐"},{name:"HTTP/2",desc:"Multiplexed connections",icon:"⚡"},{name:"Fetch",desc:"Browser & Edge runtimes",icon:"🌍"},{name:"cURL",desc:"Advanced auth & certificates",icon:"🔧"},{name:"XHR",desc:"Legacy browser support",icon:"📱"},{name:"React Native",desc:"Mobile applications",icon:"📲"}];we();var l=id();G("3qd30r",Fe=>{U(()=>{F.title="Rezo - Enterprise-grade HTTP Client for JavaScript"})});var d=p(l),u=p(d),v=p(u),h=n(v,2),g=n(h,2),y=n(u,2),x=p(y),b=p(x);let k;var w=n(p(b),2),_=p(w),S=n(b,2);let P;var I=n(S,2);let T;var A=p(I),O=n(I,2);let Z;var K=p(O),J=n(K,2),ye=n(O,2);let oe;var ie=n(x,2);let Re;var it=p(ie),Y=p(it);f(Y,{code:r,language:"typescript",filename:"app.ts"});var fe=n(d,2),_e=p(fe),Oe=p(_e);ze(Oe,5,()=>i,Ie,(Fe,qe,yt)=>{var Te=od();$t(Te,`animation-delay: ${yt*100}ms;`);var lt=p(Te),Qe=p(lt),jt=n(lt,2),It=p(jt);pe(()=>{Q(Qe,C(qe).value),Q(It,C(qe).label)}),E(Fe,Te)});var Le=n(fe,2),Xe=p(Le),ns=n(p(Xe),2);ze(ns,5,()=>a,Ie,(Fe,qe,yt)=>{var Te=rd();$t(Te,`animation-delay: ${yt*100}ms;`);var lt=p(Te),Qe=n(p(lt),2),jt=p(Qe),It=n(Qe,2),Ut=p(It),ot=n(It,2),ls=p(ot);pe(()=>{Q(jt,C(qe).icon),Q(Ut,C(qe).title),Q(ls,C(qe).description)}),E(Fe,Te)});var is=n(Le,2),Is=p(is),zs=n(p(Is),2);ze(zs,5,()=>c,Ie,(Fe,qe,yt)=>{var Te=ad();$t(Te,`animation-delay: ${yt*80}ms;`);var lt=n(p(Te),2),Qe=p(lt),jt=p(Qe),It=n(Qe,2),Ut=p(It),ot=p(Ut),ls=n(Ut,2),zt=p(ls);pe(()=>{Q(jt,C(qe).icon),Q(ot,C(qe).name),Q(zt,C(qe).desc)}),E(Fe,Te)});var cs=n(is,2),Ws=p(cs),ct=n(p(Ws),2);ze(ct,4,()=>["Node.js 22+","Bun","Deno","Browsers","React Native","Cloudflare Workers","Vercel Edge"],Ie,(Fe,qe,yt)=>{var Te=nd();$t(Te,`animation-delay: ${yt*60}ms;`);var lt=n(p(Te),2),Qe=p(lt);pe(()=>Q(Qe,qe)),E(Fe,Te)});var Ps=n(cs,2),wo=p(Ps),ko=n(p(wo),6),Ro=p(ko);pe(()=>{$t(v,`transform: translateY(${C(o)*.1}px);`),$t(h,`transform: translateY(${C(o)*-.05}px);`),$t(g,`transform: translateY(${C(o)*.08}px);`),k=kt(b,1,"inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm mb-8 version-badge svelte-3qd30r",null,k,{"animate-in":C(s)}),Q(_,`v${hs.version??""} now available`),P=kt(S,1,"text-4xl sm:text-5xl lg:text-7xl font-bold mb-6 leading-tight hero-title svelte-3qd30r",null,P,{"animate-in":C(s)}),T=kt(I,1,"text-lg sm:text-xl max-w-2xl mx-auto mb-10 hero-desc svelte-3qd30r",null,T,{"animate-in":C(s)}),Q(A,`Enterprise-grade HTTP client with HTTP/2 support, intelligent cookie management, 
          ${hs.adapterCount??""} adapters, and comprehensive proxy support. Works everywhere.`),Z=kt(O,1,"flex flex-wrap items-center justify-center gap-4 mb-12 hero-buttons svelte-3qd30r",null,Z,{"animate-in":C(s)}),oe=kt(ye,1,"flex items-center justify-center gap-4 text-sm hero-install svelte-3qd30r",null,oe,{"animate-in":C(s)}),Re=kt(ie,1,"max-w-2xl mx-auto hero-code svelte-3qd30r",null,Re,{"animate-in":C(s)})}),ee("click",K,()=>be("/docs")),ee("click",J,()=>be("/examples")),ee("click",Ro,()=>be("/docs")),E(e,l),me()}var cd=N('<div class="p-4 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);"><div class="flex items-start gap-3"><span class="text-2xl"> </span> <div><h3 class="font-semibold mb-1"> </h3> <p class="text-sm" style="color: var(--muted);"> </p></div></div></div>'),ld=N(`<div class="space-y-12"><header><h1 class="text-3xl sm:text-4xl font-bold mb-4">Introduction</h1> <p class="text-lg" style="color: var(--muted);">Welcome to Rezo, an enterprise-grade HTTP client library for Node.js 22+ and universal JavaScript runtimes.</p></header> <section><h2 class="text-2xl font-bold mb-4">What is Rezo?</h2> <p class="mb-4" style="color: var(--muted);">Rezo is a powerful, flexible HTTP client designed for modern JavaScript development. It provides 
      a clean, intuitive API while supporting advanced features like HTTP/2, intelligent cookie management, 
      proxy rotation, and comprehensive streaming support.</p> <p style="color: var(--muted);">Whether you're building a simple API client or a complex web scraper, Rezo gives you the tools 
      you need without compromising on performance or developer experience.</p></section> <section><h2 class="text-2xl font-bold mb-4">Quick Example</h2> <!></section> <section><h2 class="text-2xl font-bold mb-6">Key Features</h2> <div class="grid sm:grid-cols-2 gap-4"></div></section> <section><h2 class="text-2xl font-bold mb-4">Supported Environments</h2> <p class="mb-4" style="color: var(--muted);">Rezo works across all major JavaScript runtimes:</p> <ul class="space-y-2" style="color: var(--muted);"><li class="flex items-center gap-2"><span class="text-green-500">&#10003;</span> <strong>Node.js 22+</strong> - Full feature support with native HTTP/2</li> <li class="flex items-center gap-2"><span class="text-green-500">&#10003;</span> <strong>Bun</strong> - Optimized for Bun's fast runtime</li> <li class="flex items-center gap-2"><span class="text-green-500">&#10003;</span> <strong>Deno</strong> - Works with Deno's Node.js compatibility</li> <li class="flex items-center gap-2"><span class="text-green-500">&#10003;</span> <strong>Browsers</strong> - Via Fetch or XHR adapters</li> <li class="flex items-center gap-2"><span class="text-green-500">&#10003;</span> <strong>React Native</strong> - Dedicated mobile adapter</li> <li class="flex items-center gap-2"><span class="text-green-500">&#10003;</span> <strong>Edge Runtimes</strong> - Cloudflare Workers, Vercel Edge, etc.</li></ul></section> <section class="flex items-center gap-4"><button class="gradient-bg text-white px-6 py-3 rounded-lg font-semibold hover:opacity-90 transition-opacity cursor-pointer">Get Started</button> <button class="px-6 py-3 rounded-lg font-semibold border transition-colors hover:bg-[var(--surface)] cursor-pointer" style="border-color: var(--border); color: var(--text);">Quick Start Guide</button></section></div>`);function Lo(e,t){he(t,!1);const s=`import rezo from 'rezo';

// Simple GET request
const response = await rezo.get('https://api.example.com/users');
console.log(response.data);

// POST with JSON body
const user = await rezo.post('https://api.example.com/users', {
  name: 'John Doe',
  email: 'john@example.com'
});

// With full configuration
const data = await rezo.request({
  method: 'GET',
  url: 'https://api.example.com/posts',
  headers: { 'Authorization': 'Bearer token' },
  timeout: 5000,
  retry: { attempts: 3 }
});`,o=[{icon:"⚡",title:"HTTP/2 Support",desc:"Native HTTP/2 with session pooling and multiplexing."},{icon:"🍪",title:"Cookie Management",desc:"Automatic cookie persistence with tough-cookie."},{icon:"🌐",title:"Proxy Support",desc:"HTTP, HTTPS, SOCKS4/5 with rotation."},{icon:"🔄",title:"Retry Logic",desc:"Exponential backoff with custom strategies."},{icon:"🪝",title:"Hooks System",desc:"Request/response interception at any stage."},{icon:"📊",title:"Request Queue",desc:"Priority, concurrency, and rate limiting."}];we();var r=ld();G("16zigxp",h=>{U(()=>{F.title="Introduction - Rezo Documentation"})});var a=n(p(r),4),i=n(p(a),2);f(i,{code:s,language:"typescript",filename:"example.ts"});var c=n(a,2),l=n(p(c),2);ze(l,5,()=>o,Ie,(h,g)=>{var y=cd(),x=p(y),b=p(x),k=p(b),w=n(b,2),_=p(w),S=p(_),P=n(_,2),I=p(P);pe(()=>{Q(k,C(g).icon),Q(S,C(g).title),Q(I,C(g).desc)}),E(h,y)});var d=n(c,4),u=p(d),v=n(u,2);ee("click",u,()=>be("/installation")),ee("click",v,()=>be("/quick-start")),E(e,r),me()}var dd=N('<div class="space-y-12"><header><h1 class="text-3xl sm:text-4xl font-bold mb-4">Installation</h1> <p class="text-lg" style="color: var(--muted);">Get started with Rezo in your project. Works with npm, bun, pnpm, and yarn.</p></header> <section><h2 class="text-2xl font-bold mb-4">Package Managers</h2> <p class="mb-4" style="color: var(--muted);">Install Rezo using your preferred package manager:</p> <div class="space-y-4"><div><h3 class="text-sm font-semibold mb-2 uppercase tracking-wide" style="color: var(--muted);">npm</h3> <!></div> <div><h3 class="text-sm font-semibold mb-2 uppercase tracking-wide" style="color: var(--muted);">bun</h3> <!></div> <div><h3 class="text-sm font-semibold mb-2 uppercase tracking-wide" style="color: var(--muted);">pnpm</h3> <!></div> <div><h3 class="text-sm font-semibold mb-2 uppercase tracking-wide" style="color: var(--muted);">yarn</h3> <!></div></div></section> <section><h2 class="text-2xl font-bold mb-4">Basic Import</h2> <p class="mb-4" style="color: var(--muted);">Import Rezo in your JavaScript or TypeScript files:</p> <!> <p class="mt-4 text-sm" style="color: var(--muted);">The default import automatically selects the best adapter for your runtime environment.</p></section> <section><h2 class="text-2xl font-bold mb-4">Tree-Shaking with Specific Adapters</h2> <p class="mb-4" style="color: var(--muted);">For optimal bundle size, import only the adapter you need:</p> <!> <div class="mt-6 p-4 rounded-lg border" style="background-color: var(--surface); border-color: var(--border);"><h4 class="font-semibold mb-2">Adapter Selection Guide</h4> <ul class="space-y-2 text-sm" style="color: var(--muted);"><li><strong>http</strong> - Best for Node.js servers (cookies, proxy, streaming)</li> <li><strong>http2</strong> - Use when HTTP/2 multiplexing is needed</li> <li><strong>fetch</strong> - Best for browsers and edge runtimes</li> <li><strong>curl</strong> - Advanced auth (NTLM, Digest) and debugging</li> <li><strong>xhr</strong> - Legacy browser support with progress events</li> <li><strong>react-native</strong> - Optimized for React Native apps</li></ul></div></section> <section><h2 class="text-2xl font-bold mb-4">TypeScript Support</h2> <p class="mb-4" style="color: var(--muted);">Rezo is written in TypeScript and provides full type definitions out of the box:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Requirements</h2> <div class="grid sm:grid-cols-2 gap-4"><div class="p-4 rounded-lg" style="background-color: var(--surface);"><h4 class="font-semibold mb-2">Node.js</h4> <p class="text-sm" style="color: var(--muted);">Version 22.0.0 or higher</p></div> <div class="p-4 rounded-lg" style="background-color: var(--surface);"><h4 class="font-semibold mb-2">TypeScript</h4> <p class="text-sm" style="color: var(--muted);">Version 5.0+ recommended</p></div> <div class="p-4 rounded-lg" style="background-color: var(--surface);"><h4 class="font-semibold mb-2">Browsers</h4> <p class="text-sm" style="color: var(--muted);">Modern browsers with Fetch API</p></div> <div class="p-4 rounded-lg" style="background-color: var(--surface);"><h4 class="font-semibold mb-2">Bun/Deno</h4> <p class="text-sm" style="color: var(--muted);">Latest stable versions</p></div></div></section> <section class="flex items-center justify-between p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);"><div><h3 class="font-semibold mb-1">Next: Quick Start</h3> <p class="text-sm" style="color: var(--muted);">Learn how to make your first HTTP request</p></div> <button class="gradient-bg text-white px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity">Continue →</button></section></div>');function pd(e,t){he(t,!1);const s="npm install rezo",o="bun add rezo",r="pnpm add rezo",a="yarn add rezo",i=`import rezo from 'rezo';

// Or with destructuring
import { rezo, RezoError, RezoFormData } from 'rezo';`,c=`// Import specific adapters for tree-shaking
import rezo from 'rezo/adapters/http';       // Node.js HTTP adapter
import rezo from 'rezo/adapters/http2';      // HTTP/2 adapter
import rezo from 'rezo/adapters/fetch';      // Fetch API adapter
import rezo from 'rezo/adapters/curl';       // cURL adapter
import rezo from 'rezo/adapters/xhr';        // XHR adapter (browser)
import rezo from 'rezo/adapters/react-native'; // React Native`,l=`import rezo from 'rezo';
import type { RezoRequestConfig, RezoResponse } from 'rezo';

interface User {
  id: number;
  name: string;
  email: string;
}

// Fully typed response
const response: RezoResponse<User[]> = await rezo.get<User[]>('/api/users');
const users: User[] = response.data;`;we();var d=dd();G("17gz1i6",J=>{U(()=>{F.title="Installation - Rezo Documentation"})});var u=n(p(d),2),v=n(p(u),4),h=p(v),g=n(p(h),2);f(g,{code:s,language:"bash",showLineNumbers:!1});var y=n(h,2),x=n(p(y),2);f(x,{code:o,language:"bash",showLineNumbers:!1});var b=n(y,2),k=n(p(b),2);f(k,{code:r,language:"bash",showLineNumbers:!1});var w=n(b,2),_=n(p(w),2);f(_,{code:a,language:"bash",showLineNumbers:!1});var S=n(u,2),P=n(p(S),4);f(P,{code:i,language:"typescript"});var I=n(S,2),T=n(p(I),4);f(T,{code:c,language:"typescript"});var A=n(I,2),O=n(p(A),4);f(O,{code:l,language:"typescript",filename:"api.ts"});var Z=n(A,4),K=n(p(Z),2);ee("click",K,()=>be("/quick-start")),E(e,d),me()}var ud=N(`<div class="space-y-12"><header><h1 class="text-3xl sm:text-4xl font-bold mb-4">Quick Start</h1> <p class="text-lg" style="color: var(--muted);">Learn the basics of making HTTP requests with Rezo in just a few minutes.</p></header> <section><h2 class="text-2xl font-bold mb-4">Making a GET Request</h2> <p class="mb-4" style="color: var(--muted);">The simplest way to fetch data from an API:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Making a POST Request</h2> <p class="mb-4" style="color: var(--muted);">Send data to create a new resource:</p> <!> <p class="mt-4 text-sm" style="color: var(--muted);">Rezo automatically sets the <code>Content-Type</code> header to <code>application/json</code> and serializes the object to JSON.</p></section> <section><h2 class="text-2xl font-bold mb-4">All HTTP Methods</h2> <p class="mb-4" style="color: var(--muted);">Rezo provides convenience methods for all standard HTTP methods:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Using the Request Method</h2> <p class="mb-4" style="color: var(--muted);">For full control, use the <code>request()</code> method with a configuration object:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Query Parameters</h2> <p class="mb-4" style="color: var(--muted);">Add query parameters to your requests:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Error Handling</h2> <p class="mb-4" style="color: var(--muted);">Rezo throws errors for non-2xx status codes. Handle them with try/catch:</p> <!> <div class="mt-6 p-4 rounded-lg border-l-4 border-primary-500" style="background-color: var(--surface);"><h4 class="font-semibold mb-2">Important</h4> <p class="text-sm" style="color: var(--muted);">Unlike some HTTP clients, Rezo throws errors for 4xx and 5xx status codes by default.
        This integrates well with retry logic - if you configure retry for specific status codes,
        Rezo will retry first before throwing.</p></div></section> <section><h2 class="text-2xl font-bold mb-4">Creating an Instance</h2> <p class="mb-4" style="color: var(--muted);">Create a configured instance for a specific API:</p> <!></section> <section class="grid sm:grid-cols-2 gap-4"><button class="p-6 rounded-xl border transition-colors hover:border-primary-500/50 text-left" style="background-color: var(--surface); border-color: var(--border);"><h3 class="font-semibold mb-2">Making Requests →</h3> <p class="text-sm" style="color: var(--muted);">Deep dive into request options and body types</p></button> <button class="p-6 rounded-xl border transition-colors hover:border-primary-500/50 text-left" style="background-color: var(--surface); border-color: var(--border);"><h3 class="font-semibold mb-2">Response Handling →</h3> <p class="text-sm" style="color: var(--muted);">Learn about response data, headers, and cookies</p></button></section></div>`);function hd(e,t){he(t,!1);const s=`import rezo from 'rezo';

// Simple GET request
const response = await rezo.get('https://api.example.com/users');

console.log(response.status);     // 200
console.log(response.data);       // Response body (auto-parsed JSON)
console.log(response.headers);    // Response headers`,o=`// POST with JSON body
const response = await rezo.post('https://api.example.com/users', {
  name: 'John Doe',
  email: 'john@example.com',
  role: 'admin'
});

console.log(response.data); // Created user object`,r=`// All HTTP methods
await rezo.get(url);
await rezo.post(url, data);
await rezo.put(url, data);
await rezo.patch(url, data);
await rezo.delete(url);
await rezo.head(url);
await rezo.options(url);

// With request config
await rezo.get(url, { headers: { ... }, timeout: 5000 });
await rezo.post(url, data, { headers: { ... } });`,a=`// Using the request method
const response = await rezo.request({
  method: 'POST',
  url: 'https://api.example.com/users',
  data: {
    name: 'John Doe',
    email: 'john@example.com'
  },
  headers: {
    'Authorization': 'Bearer your-token-here',
    'Content-Type': 'application/json'
  },
  timeout: 10000
});`,i=`import { rezo, RezoError } from 'rezo';

try {
  const response = await rezo.get('https://api.example.com/users/999');
  console.log(response.data);
} catch (error) {
  if (RezoError.isRezoError(error)) {
    // HTTP error (4xx, 5xx)
    if (error.isHttpError) {
      console.log('Status:', error.status);        // 404
      console.log('Response:', error.response?.data);
    }
    
    // Network/timeout error
    if (error.isNetworkError) {
      console.log('Network failed:', error.message);
    }
    
    if (error.isTimeout) {
      console.log('Request timed out');
    }
    
    // Helpful error info
    console.log('Details:', error.details);
    console.log('Suggestion:', error.suggestion);
  }
}`,c=`// Create a configured instance
const api = rezo.create({
  baseURL: 'https://api.example.com',
  timeout: 10000,
  headers: {
    'Authorization': 'Bearer your-token',
    'Content-Type': 'application/json'
  }
});

// Use the instance
const users = await api.get('/users');
const posts = await api.get('/posts');
const newUser = await api.post('/users', { name: 'Jane' });`,l=`// Query parameters in URL
await rezo.get('https://api.example.com/users?page=1&limit=10');

// Using params option
await rezo.get('https://api.example.com/users', {
  params: {
    page: 1,
    limit: 10,
    sort: 'name',
    filter: ['active', 'verified']
  }
});
// Results in: /users?page=1&limit=10&sort=name&filter=active&filter=verified`;we();var d=ud();G("h68ri3",K=>{U(()=>{F.title="Quick Start - Rezo Documentation"})});var u=n(p(d),2),v=n(p(u),4);f(v,{code:s,language:"typescript",filename:"get-example.ts"});var h=n(u,2),g=n(p(h),4);f(g,{code:o,language:"typescript",filename:"post-example.ts"});var y=n(h,2),x=n(p(y),4);f(x,{code:r,language:"typescript"});var b=n(y,2),k=n(p(b),4);f(k,{code:a,language:"typescript",filename:"request-example.ts"});var w=n(b,2),_=n(p(w),4);f(_,{code:l,language:"typescript"});var S=n(w,2),P=n(p(S),4);f(P,{code:i,language:"typescript",filename:"error-handling.ts"});var I=n(S,2),T=n(p(I),4);f(T,{code:c,language:"typescript",filename:"api-instance.ts"});var A=n(I,2),O=p(A),Z=n(O,2);ee("click",O,()=>be("/requests")),ee("click",Z,()=>be("/responses")),E(e,d),me()}var md=N('<tr class="border-b" style="border-color: var(--border);"><td class="py-3 px-4"> </td><td class="py-3 px-4 text-center"> </td><td class="py-3 px-4 text-center"> </td><td class="py-3 px-4 text-center"> </td><td class="py-3 px-4 text-center"> </td></tr>'),fd=N(`<div class="space-y-12"><header><h1 class="text-3xl sm:text-4xl font-bold mb-4">Why Choose Rezo?</h1> <p class="text-lg" style="color: var(--muted);">Rezo is designed to be the last HTTP client you'll ever need. Here's why.</p></header> <section><h2 class="text-2xl font-bold mb-6">Feature Comparison</h2> <div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="border-b" style="border-color: var(--border);"><th class="text-left py-3 px-4 font-semibold">Feature</th><th class="text-center py-3 px-4 font-semibold gradient-text">Rezo</th><th class="text-center py-3 px-4 font-semibold">Axios</th><th class="text-center py-3 px-4 font-semibold">Got</th><th class="text-center py-3 px-4 font-semibold">SuperAgent</th></tr></thead><tbody></tbody></table></div> <p class="mt-4 text-sm" style="color: var(--muted);">✅ Full support &nbsp; ⚠️ Partial/Plugin &nbsp; ❌ Not supported</p></section> <section><h2 class="text-2xl font-bold mb-6">Key Advantages</h2> <div class="grid sm:grid-cols-2 gap-6"><div class="p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);"><h3 class="text-xl font-semibold mb-3 gradient-text">Universal Runtime Support</h3> <p style="color: var(--muted);">One library that works everywhere - Node.js, Bun, Deno, browsers, React Native, 
          and edge runtimes like Cloudflare Workers. No more maintaining different HTTP 
          clients for different platforms.</p></div> <div class="p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);"><h3 class="text-xl font-semibold mb-3 gradient-text">6 Specialized Adapters</h3> <p style="color: var(--muted);">Choose the right tool for the job. HTTP for full features, HTTP/2 for performance, 
          Fetch for browsers, cURL for advanced auth, XHR for legacy support, or React Native 
          for mobile apps.</p></div> <div class="p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);"><h3 class="text-xl font-semibold mb-3 gradient-text">Enterprise-Grade Proxy Support</h3> <p style="color: var(--muted);">Built-in ProxyManager with rotation strategies, health checking, automatic failover, 
          whitelist/blacklist filtering, and support for HTTP, HTTPS, SOCKS4, and SOCKS5 proxies.</p></div> <div class="p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);"><h3 class="text-xl font-semibold mb-3 gradient-text">Smart Cookie Management</h3> <p style="color: var(--muted);">Automatic cookie handling with tough-cookie integration. Cookies persist across 
          requests, can be serialized to multiple formats, and merge correctly with response cookies.</p></div> <div class="p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);"><h3 class="text-xl font-semibold mb-3 gradient-text">Built-in Request Queue</h3> <p style="color: var(--muted);">Zero-dependency queuing with priority levels, per-domain concurrency, rate limiting, 
          automatic retry with exponential backoff, and Retry-After header support.</p></div> <div class="p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);"><h3 class="text-xl font-semibold mb-3 gradient-text">Better Error Handling</h3> <p style="color: var(--muted);">RezoError provides professional error messages with actionable suggestions. 
          4xx/5xx responses throw errors (not silent failures), integrating perfectly with 
          retry logic.</p></div></div></section> <section><h2 class="text-2xl font-bold mb-4">Rezo vs Got</h2> <!> <div class="mt-4 p-4 rounded-lg" style="background-color: var(--surface);"><p style="color: var(--muted);">While Got is excellent for Node.js, Rezo works universally across all JavaScript 
        runtimes including browsers and edge functions, with automatic response parsing.</p></div></section> <section><h2 class="text-2xl font-bold mb-6">Who Uses Rezo?</h2> <div class="grid sm:grid-cols-3 gap-4"><div class="p-4 rounded-lg text-center" style="background-color: var(--surface);"><div class="text-3xl mb-2">🏢</div> <div class="font-semibold">Enterprise APIs</div> <p class="text-sm" style="color: var(--muted);">Complex auth, proxies, rate limiting</p></div> <div class="p-4 rounded-lg text-center" style="background-color: var(--surface);"><div class="text-3xl mb-2">🕷️</div> <div class="font-semibold">Web Scrapers</div> <p class="text-sm" style="color: var(--muted);">Cookie persistence, proxy rotation</p></div> <div class="p-4 rounded-lg text-center" style="background-color: var(--surface);"><div class="text-3xl mb-2">📱</div> <div class="font-semibold">Mobile Apps</div> <p class="text-sm" style="color: var(--muted);">React Native with full features</p></div></div></section> <section class="text-center py-8"><h2 class="text-2xl font-bold mb-4">Ready to Try Rezo?</h2> <button class="gradient-bg text-white px-6 py-3 rounded-lg font-semibold hover:opacity-90 transition-opacity inline-block">Get Started Now</button></section></div>`);function vd(e,t){he(t,!1);const s=[{feature:"HTTP/2 Support",rezo:"✅",axios:"❌",got:"✅",superagent:"❌"},{feature:"Built-in Cookie Jar",rezo:"✅",axios:"❌",got:"✅",superagent:"⚠️"},{feature:"SOCKS Proxy",rezo:"✅",axios:"⚠️",got:"✅",superagent:"❌"},{feature:"Proxy Rotation",rezo:"✅",axios:"❌",got:"❌",superagent:"❌"},{feature:"Request Queue",rezo:"✅",axios:"❌",got:"❌",superagent:"❌"},{feature:"Multiple Adapters",rezo:"✅",axios:"⚠️",got:"❌",superagent:"❌"},{feature:"Tree-Shakeable",rezo:"✅",axios:"❌",got:"❌",superagent:"❌"},{feature:"TypeScript First",rezo:"✅",axios:"✅",got:"✅",superagent:"⚠️"},{feature:"Browser Support",rezo:"✅",axios:"✅",got:"❌",superagent:"✅"},{feature:"React Native",rezo:"✅",axios:"✅",got:"❌",superagent:"⚠️"},{feature:"cURL Adapter",rezo:"✅",axios:"❌",got:"❌",superagent:"❌"},{feature:"Performance Metrics",rezo:"✅",axios:"❌",got:"⚠️",superagent:"❌"}],o=`// Got (Node.js only)
import got from 'got';
const response = await got('https://api.example.com/users');
const data = JSON.parse(response.body);

// Rezo (Universal)
import rezo from 'rezo';
const response = await rezo.get('https://api.example.com/users');
const data = response.data; // Auto-parsed, works in browsers too`;we();var r=fd();G("uuf75q",g=>{U(()=>{F.title="Why Rezo - Rezo Documentation"})});var a=n(p(r),2),i=n(p(a),2),c=p(i),l=n(p(c));ze(l,5,()=>s,Ie,(g,y)=>{var x=md(),b=p(x),k=p(b),w=n(b),_=p(w),S=n(w),P=p(S),I=n(S),T=p(I),A=n(I),O=p(A);pe(()=>{Q(k,C(y).feature),Q(_,C(y).rezo),Q(P,C(y).axios),Q(T,C(y).got),Q(O,C(y).superagent)}),E(g,x)});var d=n(a,4),u=n(p(d),2);f(u,{code:o,language:"typescript"});var v=n(d,4),h=n(p(v),2);ee("click",h,()=>be("/installation")),E(e,r),me()}var gd=N('<div class="space-y-12"><header><h1 class="text-3xl sm:text-4xl font-bold mb-4">Making Requests</h1> <p class="text-lg" style="color: var(--muted);">Learn about different request body types, headers, authentication, and more.</p></header> <section><h2 class="text-2xl font-bold mb-4">JSON Body</h2> <p class="mb-4" style="color: var(--muted);">By default, objects are serialized as JSON:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Form Data (Multipart)</h2> <p class="mb-4" style="color: var(--muted);">Use RezoFormData for file uploads and multipart form data:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">URL-Encoded Data</h2> <p class="mb-4" style="color: var(--muted);">Use URLSearchParams for form submissions:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Stream Body</h2> <p class="mb-4" style="color: var(--muted);">Stream large files without loading them into memory:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Custom Headers</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Timeouts</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Authentication</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Response Types</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Request Cancellation</h2> <!></section> <section class="flex items-center justify-between p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);"><div><h3 class="font-semibold mb-1">Next: Response Handling</h3> <p class="text-sm" style="color: var(--muted);">Learn about response data, headers, and cookies</p></div> <button class="gradient-bg text-white px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity">Continue →</button></section></div>');function bd(e,t){he(t,!1);const s=`// JSON body (default)
await rezo.post('/api/users', {
  name: 'John Doe',
  email: 'john@example.com'
});
// Content-Type: application/json is set automatically`,o=`import { RezoFormData } from 'rezo';

// Using RezoFormData
const form = new RezoFormData();
form.append('name', 'John Doe');
form.append('avatar', fs.createReadStream('./avatar.png'), {
  filename: 'avatar.png',
  contentType: 'image/png'
});

await rezo.post('/api/upload', form);

// Or use postMultipart helper
await rezo.postMultipart('/api/upload', {
  name: 'John Doe',
  avatar: fs.createReadStream('./avatar.png')
});

// Nested objects are JSON stringified
await rezo.postMultipart('/api/data', {
  name: 'John',
  metadata: { role: 'admin', active: true }, // → JSON string
  tags: ['javascript', 'http']                // → multiple entries
});`,r=`// URL-encoded form data
await rezo.post('/api/login', new URLSearchParams({
  username: 'john',
  password: 'secret123'
}));
// Content-Type: application/x-www-form-urlencoded`,a=`import { createReadStream } from 'fs';

// Stream a file as request body
const stream = createReadStream('./large-file.zip');
await rezo.post('/api/upload', stream, {
  headers: {
    'Content-Type': 'application/zip',
    'Content-Length': '104857600' // 100MB
  }
});`,i=`// Custom headers
await rezo.get('/api/protected', {
  headers: {
    'Authorization': 'Bearer your-token',
    'X-Custom-Header': 'custom-value',
    'Accept': 'application/json'
  }
});

// Headers are case-insensitive
await rezo.get('/api/data', {
  headers: {
    'content-type': 'application/json',  // Works the same as
    'Content-Type': 'application/json'   // this
  }
});`,c=`// Request timeout (in milliseconds)
await rezo.get('/api/slow-endpoint', {
  timeout: 30000 // 30 seconds
});

// Different timeout types
await rezo.get('/api/data', {
  timeout: {
    connection: 5000,  // Time to establish connection
    request: 30000,    // Total request time
    response: 10000    // Time waiting for response
  }
});`,l=`// Basic authentication
await rezo.get('/api/protected', {
  auth: {
    username: 'user',
    password: 'pass'
  }
});

// Bearer token (using headers)
await rezo.get('/api/protected', {
  headers: {
    'Authorization': 'Bearer your-jwt-token'
  }
});

// With cURL adapter: NTLM, Digest auth
import rezo from 'rezo/adapters/curl';

await rezo.get('/api/ntlm-protected', {
  auth: {
    username: 'domain\\\\user',
    password: 'pass',
    type: 'ntlm'
  }
});`,d=`// Response types
await rezo.get('/api/users');                    // Auto-detect (JSON/text)
await rezo.get('/api/users', { responseType: 'json' });
await rezo.get('/api/page', { responseType: 'text' });
await rezo.get('/api/file', { responseType: 'arraybuffer' });
await rezo.get('/api/file', { responseType: 'blob' });
await rezo.get('/api/stream', { responseType: 'stream' });`,u=`// Abort controller for cancellation
const controller = new AbortController();

const request = rezo.get('/api/long-running', {
  signal: controller.signal
});

// Cancel the request after 5 seconds
setTimeout(() => controller.abort(), 5000);

try {
  const response = await request;
} catch (error) {
  if (error.isAborted) {
    console.log('Request was cancelled');
  }
}`;we();var v=gd();G("14x435s",Re=>{U(()=>{F.title="Making Requests - Rezo Documentation"})});var h=n(p(v),2),g=n(p(h),4);f(g,{code:s,language:"typescript"});var y=n(h,2),x=n(p(y),4);f(x,{code:o,language:"typescript"});var b=n(y,2),k=n(p(b),4);f(k,{code:r,language:"typescript"});var w=n(b,2),_=n(p(w),4);f(_,{code:a,language:"typescript"});var S=n(w,2),P=n(p(S),2);f(P,{code:i,language:"typescript"});var I=n(S,2),T=n(p(I),2);f(T,{code:c,language:"typescript"});var A=n(I,2),O=n(p(A),2);f(O,{code:l,language:"typescript"});var Z=n(A,2),K=n(p(Z),2);f(K,{code:d,language:"typescript"});var J=n(Z,2),ye=n(p(J),2);f(ye,{code:u,language:"typescript"});var oe=n(J,2),ie=n(p(oe),2);ee("click",ie,()=>be("/responses")),E(e,v),me()}var yd=N(`<div class="space-y-12"><header><h1 class="text-3xl sm:text-4xl font-bold mb-4">Response Handling</h1> <p class="text-lg" style="color: var(--muted);">Learn how to work with response data, headers, cookies, and streaming responses.</p></header> <section><h2 class="text-2xl font-bold mb-4">Response Object</h2> <p class="mb-4" style="color: var(--muted);">Every successful request returns a response object with these properties:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Response Data</h2> <p class="mb-4" style="color: var(--muted);">Response data is automatically parsed based on content type:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Response Headers</h2> <p class="mb-4" style="color: var(--muted);">Access response headers using the RezoHeaders object:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Response Cookies</h2> <p class="mb-4" style="color: var(--muted);">All adapters return merged cookies (request + response):</p> <!> <div class="mt-6 p-4 rounded-lg border-l-4 border-primary-500" style="background-color: var(--surface);"><h4 class="font-semibold mb-2">Cookie Merging</h4> <p class="text-sm" style="color: var(--muted);">Rezo automatically merges request cookies with response Set-Cookie headers. 
        Response cookies with the same key and domain overwrite request cookies. 
        This ensures cookie persistence works correctly across requests.</p></div></section> <section><h2 class="text-2xl font-bold mb-4">Stream Responses</h2> <p class="mb-4" style="color: var(--muted);">Use streaming for memory-efficient handling of large responses:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Download with Progress</h2> <p class="mb-4" style="color: var(--muted);">Download files directly to disk with progress tracking:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Upload with Progress</h2> <p class="mb-4" style="color: var(--muted);">Track upload progress for large file transfers:</p> <!></section> <section class="flex items-center justify-between p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);"><div><h3 class="font-semibold mb-1">Next: Configuration</h3> <p class="text-sm" style="color: var(--muted);">Learn about instance configuration and defaults</p></div> <button class="gradient-bg text-white px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity">Continue →</button></section></div>`);function xd(e,t){he(t,!1);const s=`const response = await rezo.get('/api/users');

// Response properties
response.data       // Parsed response body (auto-detected)
response.status     // HTTP status code (200, 404, etc.)
response.statusText // Status text ("OK", "Not Found", etc.)
response.headers    // Response headers (RezoHeaders object)
response.cookies    // Response cookies (merged with request cookies)
response.config     // The request configuration used
response.request    // The underlying request object`,o=`// JSON responses are auto-parsed
const response = await rezo.get('/api/users');
const users = response.data; // Already an object

// Access typed data
interface User {
  id: number;
  name: string;
}
const response = await rezo.get<User[]>('/api/users');
const users: User[] = response.data;

// Text responses
const html = await rezo.get('/page.html', { responseType: 'text' });
console.log(html.data); // HTML string

// Binary data
const image = await rezo.get('/image.png', { responseType: 'arraybuffer' });
const buffer = image.data; // ArrayBuffer`,r=`const response = await rezo.get('/api/users');

// Access headers (case-insensitive)
response.headers.get('content-type');
response.headers.get('Content-Type'); // Same result

// Get all headers
for (const [name, value] of response.headers) {
  console.log(name, value);
}

// Check if header exists
response.headers.has('x-custom-header');

// Get multiple values (for Set-Cookie, etc.)
response.headers.getAll('set-cookie');`,a=`const response = await rezo.get('/api/login');

// Access cookies object
const cookies = response.cookies;

// Different formats available
cookies.array        // Array of cookie objects with metadata
cookies.serialized   // Object with cookie key-value pairs
cookies.netscape     // Netscape format string
cookies.string       // Simple "key=value; key2=value2" string
cookies.setCookiesString // Set-Cookie header format

// Cookie merging
// Request cookies + Response cookies = Merged result
// Response cookies overwrite request cookies with same name/domain`,i=`// Stream response for large files
const response = await rezo.getStream('/api/large-file');

// response is a StreamResponse
response.on('data', (chunk) => {
  console.log('Received chunk:', chunk.length, 'bytes');
});

response.on('end', () => {
  console.log('Download complete');
});

response.on('error', (error) => {
  console.error('Stream error:', error);
});`,c=`// Download to file with progress
const download = await rezo.download('/api/file.zip', './output.zip');

download.on('progress', (progress) => {
  console.log(\`Downloaded: \${progress.percent}%\`);
  console.log(\`Speed: \${progress.speed} bytes/sec\`);
  console.log(\`Remaining: \${progress.remaining} bytes\`);
});

download.on('complete', (stats) => {
  console.log('Download complete!');
  console.log(\`Total size: \${stats.totalBytes}\`);
  console.log(\`Duration: \${stats.duration}ms\`);
});

download.on('error', (error) => {
  console.error('Download failed:', error);
});`,l=`// Upload with progress tracking
const form = new RezoFormData();
form.append('file', fs.createReadStream('./large-file.mp4'));

const upload = await rezo.upload('/api/upload', form);

upload.on('progress', (progress) => {
  console.log(\`Uploaded: \${progress.percent}%\`);
});

upload.on('complete', (response) => {
  console.log('Upload complete!');
  console.log('Server response:', response.data);
});`;we();var d=yd();G("wbwgbm",Z=>{U(()=>{F.title="Response Handling - Rezo Documentation"})});var u=n(p(d),2),v=n(p(u),4);f(v,{code:s,language:"typescript"});var h=n(u,2),g=n(p(h),4);f(g,{code:o,language:"typescript"});var y=n(h,2),x=n(p(y),4);f(x,{code:r,language:"typescript"});var b=n(y,2),k=n(p(b),4);f(k,{code:a,language:"typescript"});var w=n(b,2),_=n(p(w),4);f(_,{code:i,language:"typescript"});var S=n(w,2),P=n(p(S),4);f(P,{code:c,language:"typescript"});var I=n(S,2),T=n(p(I),4);f(T,{code:l,language:"typescript"});var A=n(I,2),O=n(p(A),2);ee("click",O,()=>be("/configuration")),E(e,d),me()}var wd=N('<div class="space-y-12"><header><h1 class="text-3xl sm:text-4xl font-bold mb-4">Configuration</h1> <p class="text-lg" style="color: var(--muted);">Learn how to configure Rezo instances, set defaults, and customize request behavior.</p></header> <section><h2 class="text-2xl font-bold mb-4">Creating Instances</h2> <p class="mb-4" style="color: var(--muted);">Create configured instances for different APIs or use cases:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">All Configuration Options</h2> <p class="mb-4" style="color: var(--muted);">Complete list of available request configuration options:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Global and Instance Defaults</h2> <p class="mb-4" style="color: var(--muted);">Modify defaults globally or per-instance:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Header Merging</h2> <p class="mb-4" style="color: var(--muted);">Headers are merged from defaults → instance → request:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Base URL Resolution</h2> <p class="mb-4" style="color: var(--muted);">How relative and absolute URLs are resolved:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Per-Method Behavior</h2> <!></section> <section class="flex items-center justify-between p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);"><div><h3 class="font-semibold mb-1">Next: Error Handling</h3> <p class="text-sm" style="color: var(--muted);">Learn about RezoError and handling failures</p></div> <button class="gradient-bg text-white px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity">Continue →</button></section></div>');function kd(e,t){he(t,!1);const s=`import rezo from 'rezo';

// Create a configured instance
const api = rezo.create({
  baseURL: 'https://api.example.com/v1',
  timeout: 10000,
  headers: {
    'Authorization': 'Bearer default-token',
    'Content-Type': 'application/json'
  }
});

// All requests use the base configuration
await api.get('/users');        // https://api.example.com/v1/users
await api.post('/users', data); // With default headers

// Override per-request
await api.get('/users', {
  timeout: 30000,
  headers: { 'Authorization': 'Bearer other-token' }
});`,o=`interface RezoRequestConfig {
  // URL and method
  url?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  baseURL?: string;
  params?: Record<string, any>;
  
  // Request body
  data?: any;
  
  // Headers
  headers?: Record<string, string>;
  
  // Timeouts
  timeout?: number | {
    connection?: number;
    request?: number;
    response?: number;
  };
  
  // Response handling
  responseType?: 'json' | 'text' | 'arraybuffer' | 'blob' | 'stream';
  
  // Authentication
  auth?: {
    username: string;
    password: string;
    type?: 'basic' | 'digest' | 'ntlm';
  };
  
  // Cookies
  cookies?: CookieJar | Record<string, string>;
  withCredentials?: boolean;
  
  // Proxy
  proxy?: {
    host: string;
    port: number;
    protocol?: 'http' | 'https' | 'socks4' | 'socks5';
    auth?: { username: string; password: string };
  };
  
  // Retry configuration
  retry?: {
    attempts?: number;
    delay?: number;
    multiplier?: number;
    statusCodes?: number[];
    methods?: string[];
    condition?: (error: RezoError) => boolean;
  };
  
  // Redirects
  maxRedirects?: number;
  followRedirects?: boolean;
  
  // TLS/SSL
  rejectUnauthorized?: boolean;
  ca?: string | Buffer;
  cert?: string | Buffer;
  key?: string | Buffer;
  
  // Cancellation
  signal?: AbortSignal;
  
  // Adapter selection
  adapter?: 'http' | 'http2' | 'fetch' | 'curl' | 'xhr' | 'react-native';
}`,r=`// Get global defaults
console.log(rezo.defaults);

// Modify global defaults
rezo.defaults.timeout = 15000;
rezo.defaults.headers['X-Client-Version'] = '1.0.0';

// Instance defaults
const api = rezo.create({
  baseURL: 'https://api.example.com'
});

// Modify instance defaults after creation
api.defaults.timeout = 20000;
api.defaults.headers['Authorization'] = 'Bearer new-token';`,a=`// Headers are merged in order: defaults < instance < request
const api = rezo.create({
  headers: {
    'Content-Type': 'application/json',
    'X-API-Version': '1.0'
  }
});

// This request will have:
// - Content-Type: application/xml (overridden)
// - X-API-Version: 1.0 (from instance)
// - Authorization: Bearer token (from request)
await api.get('/data', {
  headers: {
    'Content-Type': 'application/xml',
    'Authorization': 'Bearer token'
  }
});`,i=`const api = rezo.create({
  baseURL: 'https://api.example.com/v1'
});

// Relative URLs are resolved against baseURL
await api.get('/users');          // https://api.example.com/v1/users
await api.get('users');           // https://api.example.com/v1/users

// Absolute URLs ignore baseURL
await api.get('https://other.com/data'); // https://other.com/data

// URLs starting with // use baseURL protocol
await api.get('//other.com/data'); // https://other.com/data`,c=`// Different defaults per HTTP method
const api = rezo.create({
  baseURL: 'https://api.example.com',
  
  // Default for all methods
  timeout: 10000,
  
  // These headers apply to all requests
  headers: {
    'Authorization': 'Bearer token'
  }
});

// POST/PUT/PATCH automatically set Content-Type if not specified
await api.post('/users', { name: 'John' });
// Content-Type: application/json (automatic)

// GET requests with query params
await api.get('/users', {
  params: { page: 1, limit: 10 }
});`;we();var l=wd();G("y6doyg",T=>{U(()=>{F.title="Configuration - Rezo Documentation"})});var d=n(p(l),2),u=n(p(d),4);f(u,{code:s,language:"typescript"});var v=n(d,2),h=n(p(v),4);f(h,{code:o,language:"typescript"});var g=n(v,2),y=n(p(g),4);f(y,{code:r,language:"typescript"});var x=n(g,2),b=n(p(x),4);f(b,{code:a,language:"typescript"});var k=n(x,2),w=n(p(k),4);f(w,{code:i,language:"typescript"});var _=n(k,2),S=n(p(_),2);f(S,{code:c,language:"typescript"});var P=n(_,2),I=n(p(P),2);ee("click",I,()=>be("/errors")),E(e,l),me()}var Rd=N(`<div class="space-y-12"><header><h1 class="text-3xl sm:text-4xl font-bold mb-4">Error Handling</h1> <p class="text-lg" style="color: var(--muted);">Learn how to handle errors gracefully with RezoError.</p></header> <section><div class="p-4 rounded-lg border-l-4 border-primary-500 mb-6" style="background-color: var(--surface);"><h4 class="font-semibold mb-2">Important: 4xx/5xx Throw Errors</h4> <p class="text-sm" style="color: var(--muted);">Unlike some HTTP clients, Rezo throws errors for 4xx and 5xx status codes by default.
        Only 2xx responses return successfully. This makes error handling explicit and integrates
        well with retry logic.</p></div></section> <section><h2 class="text-2xl font-bold mb-4">Basic Error Handling</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Error Types</h2> <p class="mb-4" style="color: var(--muted);">RezoError provides boolean flags to identify error types:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Accessing Error Response</h2> <p class="mb-4" style="color: var(--muted);">For HTTP errors, the full response is attached:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Error Codes</h2> <p class="mb-4" style="color: var(--muted);">Use error codes for programmatic error handling:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Retry Integration</h2> <p class="mb-4" style="color: var(--muted);">Errors integrate with retry logic - retries happen before throwing:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Custom Validation</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Safe Error Serialization</h2> <p class="mb-4" style="color: var(--muted);">RezoError's toJSON() method hides sensitive data for safe logging:</p> <!></section> <section class="flex items-center justify-between p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);"><div><h3 class="font-semibold mb-1">Next: Adapters</h3> <p class="text-sm" style="color: var(--muted);">Learn about the different HTTP adapters</p></div> <button class="gradient-bg text-white px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity">Continue →</button></section></div>`);function _d(e,t){he(t,!1);const s=`import { rezo, RezoError } from 'rezo';

try {
  const response = await rezo.get('/api/users/999');
} catch (error) {
  if (RezoError.isRezoError(error)) {
    console.log('Message:', error.message);
    console.log('Status:', error.status);
    console.log('Details:', error.details);
    console.log('Suggestion:', error.suggestion);
  }
}`,o=`// HTTP errors (4xx, 5xx)
if (error.isHttpError) {
  console.log('Status:', error.status);      // 404, 500, etc.
  console.log('Body:', error.response?.data); // Server response
}

// Network errors (connection refused, DNS failed)
if (error.isNetworkError) {
  console.log('Connection failed:', error.message);
}

// Timeout errors
if (error.isTimeout) {
  console.log('Request timed out');
}

// Request was aborted
if (error.isAborted) {
  console.log('Request was cancelled');
}

// Proxy errors
if (error.isProxyError) {
  console.log('Proxy connection failed');
}

// TLS/SSL errors
if (error.isTlsError) {
  console.log('Certificate validation failed');
}

// Can this error be retried?
if (error.isRetryable) {
  console.log('This error is suitable for retry');
}`,r=`try {
  await rezo.post('/api/users', { invalid: 'data' });
} catch (error) {
  if (RezoError.isRezoError(error) && error.response) {
    // Access the full response
    console.log('Status:', error.response.status);
    console.log('Headers:', error.response.headers);
    console.log('Body:', error.response.data);
    
    // Server error messages
    if (error.response.data?.message) {
      console.log('Server message:', error.response.data.message);
    }
  }
}`,a=`import { RezoErrorCode } from 'rezo';

try {
  await rezo.get('/api/data');
} catch (error) {
  if (RezoError.isRezoError(error)) {
    switch (error.code) {
      case RezoErrorCode.TIMEOUT:
        console.log('Request timed out');
        break;
      case RezoErrorCode.NETWORK_ERROR:
        console.log('Network error');
        break;
      case RezoErrorCode.HTTP_ERROR:
        console.log('HTTP error:', error.status);
        break;
      case RezoErrorCode.PROXY_ERROR:
        console.log('Proxy error');
        break;
      case RezoErrorCode.ABORT:
        console.log('Request aborted');
        break;
      default:
        console.log('Unknown error:', error.code);
    }
  }
}`,i=`// Retry integrates with error handling
const response = await rezo.get('/api/flaky', {
  retry: {
    attempts: 3,
    delay: 1000,
    multiplier: 2,
    statusCodes: [500, 502, 503, 504], // Retry these
  }
});

// Flow:
// 1. First request → 503 error
// 2. Wait 1000ms, retry → 503 error
// 3. Wait 2000ms, retry → 503 error
// 4. Wait 4000ms, retry → Still 503? Throw RezoError
// Or at any point: → 200 success? Return response`,c=`// Validate response before considering it successful
const response = await rezo.get('/api/data', {
  validateStatus: (status) => {
    // Consider 2xx and 304 as success
    return (status >= 200 && status < 300) || status === 304;
  }
});

// Custom response validation
const response = await rezo.get('/api/data', {
  validateResponse: (response) => {
    // Throw if response doesn't meet criteria
    if (!response.data?.success) {
      throw new Error('API returned error: ' + response.data?.message);
    }
    return true;
  }
});`,l=`try {
  await rezo.get('/api/data');
} catch (error) {
  if (RezoError.isRezoError(error)) {
    // Safe to log or send to error tracking
    console.log(JSON.stringify(error));
    
    // toJSON() hides sensitive config/request/response
    // Only includes: name, message, code, status, details, suggestion
    
    // Full access still available via properties
    console.log(error.config);   // Full request config
    console.log(error.request);  // Request object
    console.log(error.response); // Full response
  }
}`;we();var d=Rd();G("ywe2dh",Z=>{U(()=>{F.title="Error Handling - Rezo Documentation"})});var u=n(p(d),4),v=n(p(u),2);f(v,{code:s,language:"typescript"});var h=n(u,2),g=n(p(h),4);f(g,{code:o,language:"typescript"});var y=n(h,2),x=n(p(y),4);f(x,{code:r,language:"typescript"});var b=n(y,2),k=n(p(b),4);f(k,{code:a,language:"typescript"});var w=n(b,2),_=n(p(w),4);f(_,{code:i,language:"typescript"});var S=n(w,2),P=n(p(S),2);f(P,{code:c,language:"typescript"});var I=n(S,2),T=n(p(I),4);f(T,{code:l,language:"typescript"});var A=n(I,2),O=n(p(A),2);ee("click",O,()=>be("/adapters")),E(e,d),me()}var Cd=N('<span class="text-xs px-2 py-1 rounded" style="background-color: rgba(0, 212, 255, 0.1); color: #00d4ff;"> </span>'),Sd=N('<a class="block p-6 rounded-xl border transition-all hover:border-primary-500/50 hover:shadow-lg" style="background-color: var(--surface); border-color: var(--border);"><div class="flex items-start gap-4"><div class="text-4xl"> </div> <div class="flex-1"><div class="flex items-center gap-3 mb-2"><h3 class="text-xl font-semibold"> </h3> <span class="text-xs px-2 py-1 rounded-full" style="background-color: var(--border); color: var(--muted);"> </span></div> <p class="mb-3" style="color: var(--muted);"> </p> <div class="flex flex-wrap gap-2"></div></div> <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color: var(--muted);"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg></div></a>'),Td=N(`<div class="space-y-12"><header><h1 class="text-3xl sm:text-4xl font-bold mb-4">Adapters</h1> <p class="text-lg" style="color: var(--muted);">Rezo includes 6 specialized adapters for different runtime environments and use cases.</p></header> <section><h2 class="text-2xl font-bold mb-4">Automatic Adapter Selection</h2> <p class="mb-4" style="color: var(--muted);">By default, Rezo automatically selects the best adapter for your environment:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Explicit Adapter Import</h2> <p class="mb-4" style="color: var(--muted);">For optimal tree-shaking and control, import the adapter you need:</p> <!></section> <section><h2 class="text-2xl font-bold mb-6">Available Adapters</h2> <div class="grid gap-6"></div></section> <section><h2 class="text-2xl font-bold mb-4">Adapter Comparison</h2> <div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="border-b" style="border-color: var(--border);"><th class="text-left py-3 px-4">Feature</th><th class="text-center py-3 px-2">HTTP</th><th class="text-center py-3 px-2">HTTP/2</th><th class="text-center py-3 px-2">Fetch</th><th class="text-center py-3 px-2">cURL</th><th class="text-center py-3 px-2">XHR</th><th class="text-center py-3 px-2">RN</th></tr></thead><tbody><tr class="border-b" style="border-color: var(--border);"><td class="py-2 px-4">Cookie Jar</td><td class="text-center">✅</td><td class="text-center">✅</td><td class="text-center">✅</td><td class="text-center">✅</td><td class="text-center">⚠️</td><td class="text-center">✅</td></tr><tr class="border-b" style="border-color: var(--border);"><td class="py-2 px-4">Proxy Support</td><td class="text-center">✅</td><td class="text-center">✅</td><td class="text-center">✅*</td><td class="text-center">✅</td><td class="text-center">❌</td><td class="text-center">❌</td></tr><tr class="border-b" style="border-color: var(--border);"><td class="py-2 px-4">Streaming</td><td class="text-center">✅</td><td class="text-center">✅</td><td class="text-center">✅</td><td class="text-center">✅</td><td class="text-center">❌</td><td class="text-center">✅</td></tr><tr class="border-b" style="border-color: var(--border);"><td class="py-2 px-4">HTTP/2</td><td class="text-center">❌</td><td class="text-center">✅</td><td class="text-center">⚠️</td><td class="text-center">✅</td><td class="text-center">❌</td><td class="text-center">❌</td></tr><tr class="border-b" style="border-color: var(--border);"><td class="py-2 px-4">Browser</td><td class="text-center">❌</td><td class="text-center">❌</td><td class="text-center">✅</td><td class="text-center">❌</td><td class="text-center">✅</td><td class="text-center">❌</td></tr><tr class="border-b" style="border-color: var(--border);"><td class="py-2 px-4">Progress Events</td><td class="text-center">✅</td><td class="text-center">✅</td><td class="text-center">⚠️</td><td class="text-center">✅</td><td class="text-center">✅</td><td class="text-center">✅</td></tr></tbody></table></div> <p class="mt-4 text-sm" style="color: var(--muted);">* Fetch proxy support is Node.js only &nbsp; ⚠️ Partial/Limited support</p></section> <section><h2 class="text-2xl font-bold mb-4">Choosing the Right Adapter</h2> <div class="grid sm:grid-cols-2 gap-4"><div class="p-4 rounded-lg" style="background-color: var(--surface);"><h4 class="font-semibold mb-2">For Node.js Servers</h4> <p class="text-sm" style="color: var(--muted);">Use <strong>HTTP</strong> for full features, or <strong>HTTP/2</strong> for multiplexing and performance.</p></div> <div class="p-4 rounded-lg" style="background-color: var(--surface);"><h4 class="font-semibold mb-2">For Browsers</h4> <p class="text-sm" style="color: var(--muted);">Use <strong>Fetch</strong> for modern browsers, or <strong>XHR</strong> for legacy support with progress events.</p></div> <div class="p-4 rounded-lg" style="background-color: var(--surface);"><h4 class="font-semibold mb-2">For Edge Runtimes</h4> <p class="text-sm" style="color: var(--muted);">Use <strong>Fetch</strong> - it's the only adapter that works in Cloudflare Workers, Vercel Edge, etc.</p></div> <div class="p-4 rounded-lg" style="background-color: var(--surface);"><h4 class="font-semibold mb-2">For Web Scraping</h4> <p class="text-sm" style="color: var(--muted);">Use <strong>cURL</strong> for advanced auth (NTLM, Digest), or <strong>HTTP</strong> for cookie persistence.</p></div></div></section></div>`);function Ad(e){const t=`// Default: Auto-selects best adapter for your runtime
import rezo from 'rezo';

// Node.js/Bun/Deno → HTTP adapter
// Browser → Fetch adapter
// React Native → React Native adapter
// Cloudflare Workers → Fetch adapter`,s=`// Import specific adapters
import rezo from 'rezo/adapters/http';       // Node.js HTTP
import rezo from 'rezo/adapters/http2';      // HTTP/2
import rezo from 'rezo/adapters/fetch';      // Fetch API
import rezo from 'rezo/adapters/curl';       // cURL
import rezo from 'rezo/adapters/xhr';        // XMLHttpRequest
import rezo from 'rezo/adapters/react-native'; // React Native`,o=[{name:"HTTP",path:"/adapters/http",icon:"🌐",runtime:"Node.js, Bun, Deno",description:"Full-featured reference adapter with cookies, proxy, streaming, and compression.",features:["Cookie Jar","All Proxy Types","Streaming","Compression","TLS Config"]},{name:"HTTP/2",path:"/adapters/http2",icon:"⚡",runtime:"Node.js, Bun",description:"HTTP/2 with session pooling, multiplexing, and automatic cleanup.",features:["Session Pooling","Multiplexing","ALPN Negotiation","Fallback to HTTP/1.1"]},{name:"Fetch",path:"/adapters/fetch",icon:"🌍",runtime:"Browser, Edge, Node.js",description:"Universal Fetch API adapter for browsers and edge runtimes.",features:["Browser Native","Edge Workers","Minimal Bundle","CORS Support"]},{name:"cURL",path:"/adapters/curl",icon:"🔧",runtime:"Node.js (requires curl)",description:"cURL command-line wrapper with 200+ options and advanced auth.",features:["NTLM Auth","Digest Auth","Connection Pooling","200+ Options"]},{name:"XHR",path:"/adapters/xhr",icon:"📦",runtime:"Browser (legacy)",description:"XMLHttpRequest for legacy browser support with progress events.",features:["Upload Progress","Download Progress","Legacy Support","Sync Requests"]},{name:"React Native",path:"/adapters/react-native",icon:"📱",runtime:"React Native",description:"Optimized for React Native with manual cookie headers and fs downloads.",features:["File Downloads","Cookie Headers","Mobile Optimized","RN-FS Support"]}];var r=Td();G("whnn02",v=>{U(()=>{F.title="Adapters Overview - Rezo Documentation"})});var a=n(p(r),2),i=n(p(a),4);f(i,{code:t,language:"typescript"});var c=n(a,2),l=n(p(c),4);f(l,{code:s,language:"typescript"});var d=n(c,2),u=n(p(d),2);ze(u,5,()=>o,Ie,(v,h)=>{var g=Sd(),y=p(g),x=p(y),b=p(x),k=n(x,2),w=p(k),_=p(w),S=p(_),P=n(_,2),I=p(P),T=n(w,2),A=p(T),O=n(T,2);ze(O,5,()=>C(h).features,Ie,(Z,K)=>{var J=Cd(),ye=p(J);pe(()=>Q(ye,C(K))),E(Z,J)}),pe(()=>{ks(g,"href",C(h).path),Q(b,C(h).icon),Q(S,`${C(h).name??""} Adapter`),Q(I,C(h).runtime),Q(A,C(h).description)}),E(v,g)}),E(e,r)}var Ed=N(`<div class="space-y-12"><header><div class="flex items-center gap-3 mb-4"><span class="text-4xl">🌐</span> <h1 class="text-3xl sm:text-4xl font-bold">HTTP Adapter</h1></div> <p class="text-lg" style="color: var(--muted);">The full-featured reference adapter for Node.js, Bun, and Deno. Includes cookie jar, 
      all proxy types, streaming, compression, and comprehensive TLS configuration.</p></header> <section><h2 class="text-2xl font-bold mb-4">Basic Usage</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Cookie Jar</h2> <p class="mb-4" style="color: var(--muted);">Automatic cookie persistence with RezoCookieJar:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Proxy Support</h2> <p class="mb-4" style="color: var(--muted);">Supports HTTP, HTTPS, SOCKS4, and SOCKS5 proxies:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Streaming</h2> <p class="mb-4" style="color: var(--muted);">Memory-efficient streaming for large files:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">TLS Configuration</h2> <p class="mb-4" style="color: var(--muted);">Comprehensive TLS/SSL options:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Automatic Compression</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Features Summary</h2> <div class="grid sm:grid-cols-2 gap-4"><div class="p-4 rounded-lg" style="background-color: var(--surface);"><h4 class="font-semibold mb-2 text-green-400">✅ Supported</h4> <ul class="text-sm space-y-1" style="color: var(--muted);"><li>• Cookie jar with persistence</li> <li>• HTTP, HTTPS, SOCKS4/5 proxies</li> <li>• Request/response streaming</li> <li>• File downloads with progress</li> <li>• Gzip, deflate, brotli, zstd</li> <li>• Custom TLS certificates</li> <li>• Basic authentication</li> <li>• Timeout configuration</li></ul></div> <div class="p-4 rounded-lg" style="background-color: var(--surface);"><h4 class="font-semibold mb-2 text-red-400">❌ Not Supported</h4> <ul class="text-sm space-y-1" style="color: var(--muted);"><li>• Browser environment</li> <li>• HTTP/2 (use HTTP/2 adapter)</li> <li>• NTLM/Digest auth (use cURL)</li></ul></div></div></section> <section class="flex items-center justify-between p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);"><div><h3 class="font-semibold mb-1">Next: HTTP/2 Adapter</h3> <p class="text-sm" style="color: var(--muted);">Learn about HTTP/2 with session pooling</p></div> <button class="gradient-bg text-white px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity">Continue →</button></section></div>`);function Id(e,t){he(t,!1);const s=`import rezo from 'rezo/adapters/http';

// All standard request methods
const response = await rezo.get('https://api.example.com/users');
const created = await rezo.post('https://api.example.com/users', { name: 'John' });`,o=`import rezo from 'rezo/adapters/http';
import { RezoCookieJar } from 'rezo';

// Create a cookie jar for persistence
const myJar = new RezoCookieJar();

// Create an instance with the jar (recommended)
const client = rezo.create({ jar: myJar });
await client.get('https://example.com/login');
await client.get('https://example.com/dashboard'); // Cookies included

// Access stored cookies
const cookies = myJar.getCookiesSync('https://example.com');
console.log(cookies);`,r=`// HTTP proxy
await rezo.get('https://api.example.com', {
  proxy: {
    host: 'proxy.example.com',
    port: 8080
  }
});

// HTTPS proxy with auth
await rezo.get('https://api.example.com', {
  proxy: {
    host: 'proxy.example.com',
    port: 8080,
    protocol: 'https',
    auth: {
      username: 'user',
      password: 'pass'
    }
  }
});

// SOCKS5 proxy
await rezo.get('https://api.example.com', {
  proxy: {
    host: 'socks.example.com',
    port: 1080,
    protocol: 'socks5'
  }
});`,a=`// Stream response
const stream = await rezo.getStream('https://example.com/large-file');

stream.on('data', (chunk) => {
  console.log('Received:', chunk.length, 'bytes');
});

stream.on('end', () => console.log('Complete'));

// Download to file
const download = await rezo.download(
  'https://example.com/file.zip',
  './downloads/file.zip'
);

download.on('progress', (p) => {
  console.log(\`Progress: \${p.percent}%\`);
});`,i=`// Custom TLS configuration
await rezo.get('https://internal-api.company.com', {
  // Custom CA certificate
  ca: fs.readFileSync('./certs/ca.pem'),
  
  // Client certificate authentication
  cert: fs.readFileSync('./certs/client.pem'),
  key: fs.readFileSync('./certs/client-key.pem'),
  
  // Skip certificate validation (not recommended for production)
  rejectUnauthorized: false
});`,c=`// Compression is automatic
// Requests include: Accept-Encoding: gzip, deflate, br, zstd
// Responses are automatically decompressed

const response = await rezo.get('https://api.example.com/data');
// response.data is already decompressed

// Disable compression
await rezo.get('https://api.example.com/data', {
  decompress: false
});`;we();var l=Ed();G("101v3w9",T=>{U(()=>{F.title="HTTP Adapter - Rezo Documentation"})});var d=n(p(l),2),u=n(p(d),2);f(u,{code:s,language:"typescript"});var v=n(d,2),h=n(p(v),4);f(h,{code:o,language:"typescript"});var g=n(v,2),y=n(p(g),4);f(y,{code:r,language:"typescript"});var x=n(g,2),b=n(p(x),4);f(b,{code:a,language:"typescript"});var k=n(x,2),w=n(p(k),4);f(w,{code:i,language:"typescript"});var _=n(k,2),S=n(p(_),2);f(S,{code:c,language:"typescript"});var P=n(_,4),I=n(p(P),2);ee("click",I,()=>be("/adapters/http2")),E(e,l),me()}var zd=N(`<div class="space-y-12"><header><div class="flex items-center gap-3 mb-4"><span class="text-4xl">⚡</span> <h1 class="text-3xl sm:text-4xl font-bold">HTTP/2 Adapter</h1></div> <p class="text-lg" style="color: var(--muted);">HTTP/2 adapter with session pooling, stream multiplexing, ALPN negotiation, 
      and automatic cleanup. Perfect for high-performance API clients.</p></header> <section><h2 class="text-2xl font-bold mb-4">Basic Usage</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Session Pooling</h2> <p class="mb-4" style="color: var(--muted);">HTTP/2 sessions are automatically pooled and reused:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">ALPN Negotiation</h2> <p class="mb-4" style="color: var(--muted);">Automatically negotiates the best protocol with the server:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Multiplexing Benefits</h2> <p class="mb-4" style="color: var(--muted);">Multiple requests share a single connection for better performance:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">FormData Handling</h2> <p class="mb-4" style="color: var(--muted);">FormData works seamlessly with HTTP/2:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">When to Use HTTP/2</h2> <div class="grid sm:grid-cols-2 gap-4"><div class="p-4 rounded-lg" style="background-color: var(--surface);"><h4 class="font-semibold mb-2 text-green-400">✅ Use HTTP/2 When</h4> <ul class="text-sm space-y-1" style="color: var(--muted);"><li>• Making many requests to same origin</li> <li>• Need multiplexed streams</li> <li>• Want connection reuse</li> <li>• Server supports HTTP/2</li></ul></div> <div class="p-4 rounded-lg" style="background-color: var(--surface);"><h4 class="font-semibold mb-2 text-yellow-400">⚠️ Consider HTTP Instead</h4> <ul class="text-sm space-y-1" style="color: var(--muted);"><li>• Single requests to many origins</li> <li>• Server doesn't support HTTP/2</li> <li>• Need simpler debugging</li></ul></div></div></section> <section class="flex items-center justify-between p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);"><div><h3 class="font-semibold mb-1">Next: Fetch Adapter</h3> <p class="text-sm" style="color: var(--muted);">Learn about the universal Fetch adapter</p></div> <button class="gradient-bg text-white px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity">Continue →</button></section></div>`);function Pd(e,t){he(t,!1);const s=`import rezo from 'rezo/adapters/http2';

// Uses HTTP/2 with session pooling
const response = await rezo.get('https://api.example.com/users');

// Multiple requests to same origin share a session
await Promise.all([
  rezo.get('https://api.example.com/users'),
  rezo.get('https://api.example.com/posts'),
  rezo.get('https://api.example.com/comments'),
]); // All multiplexed over single connection`,o=`// Sessions are automatically pooled per origin
// This is handled internally - no configuration needed

// First request: creates new HTTP/2 session
await rezo.get('https://api.example.com/a');

// Subsequent requests: reuse existing session
await rezo.get('https://api.example.com/b');
await rezo.get('https://api.example.com/c');

// Different origin: creates new session
await rezo.get('https://other-api.com/data');

// Sessions are cleaned up on process exit`,r=`// ALPN (Application-Layer Protocol Negotiation)
// HTTP/2 adapter automatically negotiates the best protocol

// If server supports HTTP/2 → uses HTTP/2
// If server only supports HTTP/1.1 → falls back automatically

const response = await rezo.get('https://api.example.com');
console.log(response.httpVersion); // '2' or '1.1'`,a=`// HTTP/2 multiplexing benefits
// Multiple requests share a single TCP connection

const start = Date.now();

// These all run concurrently over one connection
const results = await Promise.all([
  rezo.get('https://api.example.com/resource/1'),
  rezo.get('https://api.example.com/resource/2'),
  rezo.get('https://api.example.com/resource/3'),
  rezo.get('https://api.example.com/resource/4'),
  rezo.get('https://api.example.com/resource/5'),
]);

console.log(\`Completed in \${Date.now() - start}ms\`);
// Much faster than HTTP/1.1 which would open 5 connections`,i=`import rezo from 'rezo/adapters/http2';
import { RezoFormData } from 'rezo';

// FormData works with HTTP/2
// Headers are set before request creation (HTTP/2 requirement)
const form = new RezoFormData();
form.append('file', fs.createReadStream('./upload.pdf'));
form.append('name', 'document.pdf');

await rezo.post('https://api.example.com/upload', form);

// Or use postMultipart helper
await rezo.postMultipart('https://api.example.com/upload', {
  file: fs.createReadStream('./upload.pdf'),
  name: 'document.pdf'
});`;we();var c=zd();G("wxatvj",S=>{U(()=>{F.title="HTTP/2 Adapter - Rezo Documentation"})});var l=n(p(c),2),d=n(p(l),2);f(d,{code:s,language:"typescript"});var u=n(l,2),v=n(p(u),4);f(v,{code:o,language:"typescript"});var h=n(u,2),g=n(p(h),4);f(g,{code:r,language:"typescript"});var y=n(h,2),x=n(p(y),4);f(x,{code:a,language:"typescript"});var b=n(y,2),k=n(p(b),4);f(k,{code:i,language:"typescript"});var w=n(b,4),_=n(p(w),2);ee("click",_,()=>be("/adapters/fetch")),E(e,c),me()}var Nd=N(`<div class="space-y-12"><header><div class="flex items-center gap-3 mb-4"><span class="text-4xl">🌍</span> <h1 class="text-3xl sm:text-4xl font-bold">Fetch Adapter</h1></div> <p class="text-lg" style="color: var(--muted);">Universal Fetch API adapter for browsers, Node.js, and edge runtimes. 
      The most portable adapter with minimal bundle size.</p></header> <section><h2 class="text-2xl font-bold mb-4">Basic Usage</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Browser Usage</h2> <p class="mb-4" style="color: var(--muted);">In browsers, Fetch adapter uses native Fetch API with CORS support:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Edge Runtimes</h2> <p class="mb-4" style="color: var(--muted);">The Fetch adapter is the only one that works in edge runtimes:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Node.js Mode</h2> <p class="mb-4" style="color: var(--muted);">In Node.js, Fetch adapter gains additional features:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Streaming</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Dual-Mode Features</h2> <div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="border-b" style="border-color: var(--border);"><th class="text-left py-3 px-4">Feature</th><th class="text-center py-3 px-4">Browser</th><th class="text-center py-3 px-4">Node.js</th><th class="text-center py-3 px-4">Edge</th></tr></thead><tbody><tr class="border-b" style="border-color: var(--border);"><td class="py-2 px-4">Basic Requests</td><td class="text-center">✅</td><td class="text-center">✅</td><td class="text-center">✅</td></tr><tr class="border-b" style="border-color: var(--border);"><td class="py-2 px-4">Cookie Jar</td><td class="text-center">❌</td><td class="text-center">✅</td><td class="text-center">❌</td></tr><tr class="border-b" style="border-color: var(--border);"><td class="py-2 px-4">Proxy Support</td><td class="text-center">❌</td><td class="text-center">✅</td><td class="text-center">❌</td></tr><tr class="border-b" style="border-color: var(--border);"><td class="py-2 px-4">Streaming</td><td class="text-center">✅</td><td class="text-center">✅</td><td class="text-center">✅</td></tr><tr class="border-b" style="border-color: var(--border);"><td class="py-2 px-4">CORS</td><td class="text-center">✅</td><td class="text-center">N/A</td><td class="text-center">N/A</td></tr></tbody></table></div></section> <section class="flex items-center justify-between p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);"><div><h3 class="font-semibold mb-1">Next: cURL Adapter</h3> <p class="text-sm" style="color: var(--muted);">Learn about advanced auth and debugging</p></div> <button class="gradient-bg text-white px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity">Continue →</button></section></div>`);function Md(e,t){he(t,!1);const s=`import rezo from 'rezo/adapters/fetch';

// Works in browsers, Node.js, Deno, and edge runtimes
const response = await rezo.get('https://api.example.com/users');
console.log(response.data);`,o=`// Browser environment
import rezo from 'rezo/adapters/fetch';

// CORS requests
const response = await rezo.get('https://api.example.com/data', {
  mode: 'cors',
  credentials: 'include' // Send cookies
});

// Credentials options
await rezo.get('/api/protected', { credentials: 'same-origin' });
await rezo.get('https://other.com/api', { credentials: 'include' });
await rezo.get('/api/public', { credentials: 'omit' });`,r=`// Cloudflare Workers / Vercel Edge
import rezo from 'rezo/adapters/fetch';

export default {
  async fetch(request: Request): Promise<Response> {
    // Fetch adapter is the only one that works in edge runtimes
    const data = await rezo.get('https://api.example.com/data');
    
    return new Response(JSON.stringify(data.data), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};`,a=`// Node.js mode (different from browser mode)
// In Node.js, Fetch adapter supports cookies and proxies

import rezo from 'rezo/adapters/fetch';
import { RezoCookieJar } from 'rezo';

// Cookie jar works in Node.js - use jar when creating an instance
const myJar = new RezoCookieJar();
const client = rezo.create({ jar: myJar });
await client.get('https://example.com');

// Proxy works in Node.js
await rezo.get('https://example.com', {
  proxy: {
    host: 'proxy.example.com',
    port: 8080
  }
});`,i=`// Streaming with Fetch adapter
const response = await rezo.get('https://example.com/stream', {
  responseType: 'stream'
});

// response.data is a ReadableStream
const reader = response.data.getReader();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  console.log('Chunk:', value);
}`;we();var c=Nd();G("7snm6h",S=>{U(()=>{F.title="Fetch Adapter - Rezo Documentation"})});var l=n(p(c),2),d=n(p(l),2);f(d,{code:s,language:"typescript"});var u=n(l,2),v=n(p(u),4);f(v,{code:o,language:"typescript"});var h=n(u,2),g=n(p(h),4);f(g,{code:r,language:"typescript"});var y=n(h,2),x=n(p(y),4);f(x,{code:a,language:"typescript"});var b=n(y,2),k=n(p(b),2);f(k,{code:i,language:"typescript"});var w=n(b,4),_=n(p(w),2);ee("click",_,()=>be("/adapters/curl")),E(e,c),me()}var Dd=N(`<div class="space-y-12"><header><div class="flex items-center gap-3 mb-4"><span class="text-4xl">🔧</span> <h1 class="text-3xl sm:text-4xl font-bold">cURL Adapter</h1></div> <p class="text-lg" style="color: var(--muted);">cURL command-line wrapper with 200+ options, advanced authentication 
      (NTLM, Digest, Negotiate), and powerful debugging capabilities.</p></header> <section class="p-4 rounded-lg border-l-4 border-yellow-500" style="background-color: var(--surface);"><h4 class="font-semibold mb-2">Requires cURL</h4> <p class="text-sm" style="color: var(--muted);">This adapter requires cURL to be installed on the system. Most Unix-like systems 
      have it pre-installed. On Windows, install via chocolatey: <code>choco install curl</code></p></section> <section><h2 class="text-2xl font-bold mb-4">Basic Usage</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Advanced Authentication</h2> <p class="mb-4" style="color: var(--muted);">cURL adapter supports authentication methods not available in other adapters:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Direct cURL Options</h2> <p class="mb-4" style="color: var(--muted);">Pass any cURL option directly for maximum control:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Debugging</h2> <p class="mb-4" style="color: var(--muted);">Get the exact cURL command or enable verbose output:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Connection Pooling</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">When to Use cURL</h2> <div class="grid sm:grid-cols-2 gap-4"><div class="p-4 rounded-lg" style="background-color: var(--surface);"><h4 class="font-semibold mb-2 text-green-400">✅ Perfect For</h4> <ul class="text-sm space-y-1" style="color: var(--muted);"><li>• NTLM/Digest/Negotiate auth</li> <li>• Windows network integration</li> <li>• Advanced debugging</li> <li>• Maximum protocol control</li></ul></div> <div class="p-4 rounded-lg" style="background-color: var(--surface);"><h4 class="font-semibold mb-2 text-yellow-400">⚠️ Considerations</h4> <ul class="text-sm space-y-1" style="color: var(--muted);"><li>• Requires cURL installation</li> <li>• Spawns child processes</li> <li>• Slightly higher overhead</li></ul></div></div></section> <section class="flex items-center justify-between p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);"><div><h3 class="font-semibold mb-1">Next: XHR Adapter</h3> <p class="text-sm" style="color: var(--muted);">Learn about XMLHttpRequest for browsers</p></div> <button class="gradient-bg text-white px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity">Continue →</button></section></div>`);function Od(e,t){he(t,!1);const s=`import rezo from 'rezo/adapters/curl';

// Uses cURL command-line under the hood
const response = await rezo.get('https://api.example.com/users');`,o=`// NTLM authentication (Windows networks)
await rezo.get('https://intranet.company.com/api', {
  auth: {
    username: 'DOMAIN\\\\username',
    password: 'password',
    type: 'ntlm'
  }
});

// Digest authentication
await rezo.get('https://secure.example.com/api', {
  auth: {
    username: 'user',
    password: 'pass',
    type: 'digest'
  }
});

// Negotiate (Kerberos/SPNEGO)
await rezo.get('https://kerberos.company.com/api', {
  auth: {
    type: 'negotiate'
  }
});`,r=`// Use typed curl options for maximum control
await rezo.get('https://example.com', {
  curl: {
    // Connection options
    connectTimeout: 10,
    maxTime: 30,
    
    // TLS/SSL configuration
    tls: {
      insecure: true,
      cacert: '/path/to/ca.pem',
      min: 'tlsv1.2'
    },
    
    // Retry with exponential backoff
    retry: {
      attempts: 3,
      delay: 2,
      allErrors: true
    },
    
    // Debugging
    verbose: true,
    
    // Rate limiting
    limitRate: '500K',
    
    // HTTP version
    httpVersion: '2',
    
    // And 100+ more typed options...
  }
});`,a=`// Get the actual cURL command for debugging
const response = await rezo.get('https://api.example.com', {
  curl: {
    returnCommand: true
  }
});

console.log(response.curlCommand);
// curl -X GET 'https://api.example.com' -H 'Accept: application/json' ...

// Verbose output for detailed request/response info
await rezo.get('https://api.example.com', {
  curl: {
    verbose: true,
    output: {
      trace: '/tmp/curl-trace.log',
      traceTime: true
    }
  }
});`,i=`// cURL adapter supports connection reuse
// Multiple requests to same host reuse connections

await Promise.all([
  rezo.get('https://api.example.com/a'),
  rezo.get('https://api.example.com/b'),
  rezo.get('https://api.example.com/c'),
]);`;we();var c=Dd();G("4vqdbb",S=>{U(()=>{F.title="cURL Adapter - Rezo Documentation"})});var l=n(p(c),4),d=n(p(l),2);f(d,{code:s,language:"typescript"});var u=n(l,2),v=n(p(u),4);f(v,{code:o,language:"typescript"});var h=n(u,2),g=n(p(h),4);f(g,{code:r,language:"typescript"});var y=n(h,2),x=n(p(y),4);f(x,{code:a,language:"typescript"});var b=n(y,2),k=n(p(b),2);f(k,{code:i,language:"typescript"});var w=n(b,4),_=n(p(w),2);ee("click",_,()=>be("/adapters/xhr")),E(e,c),me()}var Hd=N(`<div class="space-y-12"><header><div class="flex items-center gap-3 mb-4"><span class="text-4xl">📦</span> <h1 class="text-3xl sm:text-4xl font-bold">XHR Adapter</h1></div> <p class="text-lg" style="color: var(--muted);">XMLHttpRequest adapter for legacy browser support with upload/download 
      progress events and synchronous request capability.</p></header> <section><h2 class="text-2xl font-bold mb-4">Basic Usage</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Progress Events</h2> <p class="mb-4" style="color: var(--muted);">Track upload and download progress with callbacks:</p> <!> <div class="mt-4 p-4 rounded-lg border-l-4 border-primary-500" style="background-color: var(--surface);"><h4 class="font-semibold mb-2">Why XHR for Progress?</h4> <p class="text-sm" style="color: var(--muted);">The Fetch API doesn't support upload progress events. If you need upload 
        progress tracking in browsers, use the XHR adapter.</p></div></section> <section><h2 class="text-2xl font-bold mb-4">Credentials</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Response Types</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Synchronous Requests</h2> <!> <div class="mt-4 p-4 rounded-lg border-l-4 border-red-500" style="background-color: var(--surface);"><h4 class="font-semibold mb-2">Warning: Avoid Synchronous Requests</h4> <p class="text-sm" style="color: var(--muted);">Synchronous XHR blocks the browser's main thread and causes poor user experience.
        Only use when absolutely necessary (e.g., beforeunload handlers).</p></div></section> <section><h2 class="text-2xl font-bold mb-4">XHR vs Fetch</h2> <div class="grid sm:grid-cols-2 gap-4"><div class="p-4 rounded-lg" style="background-color: var(--surface);"><h4 class="font-semibold mb-2">Use XHR When</h4> <ul class="text-sm space-y-1" style="color: var(--muted);"><li>• Need upload progress events</li> <li>• Supporting older browsers</li> <li>• Need synchronous requests</li> <li>• Need to abort requests easily</li></ul></div> <div class="p-4 rounded-lg" style="background-color: var(--surface);"><h4 class="font-semibold mb-2">Use Fetch When</h4> <ul class="text-sm space-y-1" style="color: var(--muted);"><li>• Modern browsers only</li> <li>• Want smaller bundle</li> <li>• Need streaming responses</li> <li>• Cleaner Promise API</li></ul></div></div></section> <section class="flex items-center justify-between p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);"><div><h3 class="font-semibold mb-1">Next: React Native Adapter</h3> <p class="text-sm" style="color: var(--muted);">Learn about mobile-optimized HTTP</p></div> <button class="gradient-bg text-white px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity">Continue →</button></section></div>`);function Ld(e,t){he(t,!1);const s=`import rezo from 'rezo/adapters/xhr';

// Uses XMLHttpRequest
const response = await rezo.get('/api/users');
console.log(response.data);`,o=`// Upload progress
const form = new FormData();
form.append('file', largeFile);

const upload = await rezo.post('/api/upload', form, {
  onUploadProgress: (event) => {
    const percent = Math.round((event.loaded / event.total) * 100);
    console.log(\`Upload: \${percent}%\`);
    updateProgressBar(percent);
  }
});

// Download progress
await rezo.get('/api/large-file', {
  onDownloadProgress: (event) => {
    const percent = Math.round((event.loaded / event.total) * 100);
    console.log(\`Download: \${percent}%\`);
  }
});`,r=`// Send cookies with cross-origin requests
await rezo.get('https://api.example.com/data', {
  withCredentials: true
});

// Equivalent to:
// xhr.withCredentials = true`,a=`// Different response types
await rezo.get('/api/data');           // Auto-detect (text/json)
await rezo.get('/api/data', { responseType: 'json' });
await rezo.get('/api/page', { responseType: 'text' });
await rezo.get('/api/file', { responseType: 'arraybuffer' });
await rezo.get('/api/file', { responseType: 'blob' });
await rezo.get('/api/doc', { responseType: 'document' });`,i=`// Synchronous requests (not recommended)
// Only use when absolutely necessary
const response = await rezo.get('/api/data', {
  async: false // Blocks the main thread!
});`;we();var c=Hd();G("74xr1z",S=>{U(()=>{F.title="XHR Adapter - Rezo Documentation"})});var l=n(p(c),2),d=n(p(l),2);f(d,{code:s,language:"typescript"});var u=n(l,2),v=n(p(u),4);f(v,{code:o,language:"typescript"});var h=n(u,2),g=n(p(h),2);f(g,{code:r,language:"typescript"});var y=n(h,2),x=n(p(y),2);f(x,{code:a,language:"typescript"});var b=n(y,2),k=n(p(b),2);f(k,{code:i,language:"typescript"});var w=n(b,4),_=n(p(w),2);ee("click",_,()=>be("/adapters/react-native")),E(e,c),me()}var qd=N(`<div class="space-y-12"><header><div class="flex items-center gap-3 mb-4"><span class="text-4xl">📱</span> <h1 class="text-3xl sm:text-4xl font-bold">React Native Adapter</h1></div> <p class="text-lg" style="color: var(--muted);">Mobile-optimized HTTP adapter with manual cookie headers, react-native-fs 
      download support, and platform-specific optimizations.</p></header> <section><h2 class="text-2xl font-bold mb-4">Basic Usage</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Cookie Handling</h2> <p class="mb-4" style="color: var(--muted);">Cookies are handled via headers since React Native doesn't support cookie jars:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">File Downloads</h2> <p class="mb-4" style="color: var(--muted);">Download files with progress using react-native-fs:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">File Uploads</h2> <p class="mb-4" style="color: var(--muted);">Upload files from the device:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Image Picker Integration</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Setup Requirements</h2> <div class="p-4 rounded-lg" style="background-color: var(--surface);"><h4 class="font-semibold mb-3">Optional Dependencies</h4> <ul class="text-sm space-y-2" style="color: var(--muted);"><li><code class="px-2 py-0.5 rounded" style="background-color: var(--border);">react-native-fs</code> - For file downloads</li> <li><code class="px-2 py-0.5 rounded" style="background-color: var(--border);">react-native-image-picker</code> - For camera/gallery uploads</li> <li><code class="px-2 py-0.5 rounded" style="background-color: var(--border);">react-native-document-picker</code> - For document uploads</li></ul></div></section> <section><h2 class="text-2xl font-bold mb-4">Platform Considerations</h2> <div class="grid sm:grid-cols-2 gap-4"><div class="p-4 rounded-lg" style="background-color: var(--surface);"><h4 class="font-semibold mb-2">iOS</h4> <ul class="text-sm space-y-1" style="color: var(--muted);"><li>• ATS (App Transport Security) applies</li> <li>• HTTPS required by default</li> <li>• Add exceptions in Info.plist if needed</li></ul></div> <div class="p-4 rounded-lg" style="background-color: var(--surface);"><h4 class="font-semibold mb-2">Android</h4> <ul class="text-sm space-y-1" style="color: var(--muted);"><li>• Network security config applies</li> <li>• Cleartext traffic disabled by default</li> <li>• Add network_security_config.xml if needed</li></ul></div></div></section> <section class="flex items-center justify-between p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);"><div><h3 class="font-semibold mb-1">Next: Cookie Management</h3> <p class="text-sm" style="color: var(--muted);">Learn about advanced cookie handling</p></div> <button class="gradient-bg text-white px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity">Continue →</button></section></div>`);function Bd(e,t){he(t,!1);const s=`import rezo from 'rezo/adapters/react-native';

// Optimized for React Native environment
const response = await rezo.get('https://api.example.com/users');
console.log(response.data);`,o=`// Cookies are handled via headers (not cookie jar)
// This is because React Native's networking doesn't support cookie jars

await rezo.get('https://api.example.com/protected', {
  headers: {
    'Cookie': 'session=abc123; token=xyz789'
  }
});

// Response cookies are parsed from headers
const response = await rezo.get('https://api.example.com/login');
console.log(response.cookies); // Parsed from Set-Cookie headers`,r=`// Download files with react-native-fs
import RNFS from 'react-native-fs';

const download = await rezo.download(
  'https://example.com/video.mp4',
  RNFS.DocumentDirectoryPath + '/video.mp4'
);

download.on('progress', (p) => {
  console.log(\`Downloaded: \${p.percent}%\`);
});

download.on('complete', () => {
  console.log('Download complete!');
});`,a=`import { RezoFormData } from 'rezo';

// Upload files from local storage
const form = new RezoFormData();
form.append('photo', {
  uri: 'file:///path/to/photo.jpg',
  type: 'image/jpeg',
  name: 'photo.jpg'
});

const response = await rezo.post('https://api.example.com/upload', form);`,i=`// Upload from camera/gallery
import { launchImageLibrary } from 'react-native-image-picker';

const result = await launchImageLibrary({ mediaType: 'photo' });
const asset = result.assets?.[0];

if (asset) {
  const form = new RezoFormData();
  form.append('photo', {
    uri: asset.uri,
    type: asset.type || 'image/jpeg',
    name: asset.fileName || 'photo.jpg'
  });
  
  await rezo.post('https://api.example.com/photos', form);
}`;we();var c=qd();G("1xxqu1p",S=>{U(()=>{F.title="React Native Adapter - Rezo Documentation"})});var l=n(p(c),2),d=n(p(l),2);f(d,{code:s,language:"typescript"});var u=n(l,2),v=n(p(u),4);f(v,{code:o,language:"typescript"});var h=n(u,2),g=n(p(h),4);f(g,{code:r,language:"typescript"});var y=n(h,2),x=n(p(y),4);f(x,{code:a,language:"typescript"});var b=n(y,2),k=n(p(b),2);f(k,{code:i,language:"typescript"});var w=n(b,6),_=n(p(w),2);ee("click",_,()=>be("/advanced/cookies")),E(e,c),me()}var jd=N(`<div class="space-y-12"><header><h1 class="text-3xl sm:text-4xl font-bold mb-4">Cookies & Sessions</h1> <p class="text-lg" style="color: var(--muted);">Learn about Rezo's intelligent cookie handling with RezoCookieJar.</p></header> <section class="info-box svelte-2et6jc"><h3 class="text-lg font-semibold mb-2">Key Concepts</h3> <ul class="list-disc ml-5 space-y-1" style="color: var(--muted);"><li><strong>jar</strong> - Cookie jar instance (pass via constructor, NOT per-request)</li> <li><strong>cookies</strong> - Ad-hoc cookies for individual requests</li> <li><strong>cookieJar</strong> - Instance property to access/replace the jar</li></ul></section> <section class="warning-box svelte-2et6jc"><h3 class="text-lg font-semibold mb-2">Fetch Adapter Limitation</h3> <p style="color: var(--muted);">The Fetch adapter supports cookies in Node.js, Deno, Bun, and edge runtimes, but <strong>NOT in browsers</strong>.
      Browser security restrictions prevent the Fetch API from accessing cookies programmatically.
      Use the HTTP adapter or XHR adapter for browser cookie management.</p></section> <section><h2 class="text-2xl font-bold mb-4">Cookie Jar</h2> <p class="mb-4" style="color: var(--muted);">Use RezoCookieJar for automatic cookie persistence:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Response Cookies</h2> <p class="mb-4" style="color: var(--muted);">Cookies are available in multiple formats:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Cookie Merging</h2> <p class="mb-4" style="color: var(--muted);">Request and response cookies are automatically merged:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Serialization</h2> <p class="mb-4" style="color: var(--muted);">Save and restore cookies for long-term persistence:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Ad-Hoc Cookies</h2> <p class="mb-4" style="color: var(--muted);">Use the <code class="svelte-2et6jc">cookies</code> option for one-time cookies on individual requests.
      This is the recommended way to send custom cookies without affecting the cookie jar:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Manual Cookies (Legacy)</h2> <p class="mb-4" style="color: var(--muted);">You can also set cookies via headers, but the <code class="svelte-2et6jc">cookies</code> option above is preferred:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Instance Cookie Jar</h2> <p class="mb-4" style="color: var(--muted);">Every Rezo instance has a built-in cookie jar. Access it via the <code class="svelte-2et6jc">cookieJar</code> property:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Creating Instances with Cookie Jars</h2> <p class="mb-4" style="color: var(--muted);">Pass a cookie jar when creating a Rezo instance for shared cookie management:</p> <!></section> <section class="tip-box svelte-2et6jc"><h3 class="text-lg font-semibold mb-2">Best Practices</h3> <ul class="list-disc ml-5 space-y-1" style="color: var(--muted);"><li>Pass <code class="svelte-2et6jc">jar</code> when creating the Rezo instance, not per-request</li> <li>Use <code class="svelte-2et6jc">cookies</code> option for ad-hoc cookies on specific requests</li> <li>Access the instance jar via <code class="svelte-2et6jc">client.cookieJar</code> property</li> <li>Per-request <code class="svelte-2et6jc">jar</code> is supported but NOT recommended</li></ul></section></div>`);function Ud(e){const t=`// Use the cookies option for ad-hoc/one-time cookies
// (NOT the jar option - jar is for cookie jar management)
await rezo.get('https://example.com', {
  cookies: {
    session: 'abc123',
    user: 'john'
  }
});

// Or as an array
await rezo.get('https://example.com', {
  cookies: [
    { key: 'session', value: 'abc123', domain: 'example.com' }
  ]
});

// Or as a Netscape format string
await rezo.get('https://example.com', {
  cookies: 'session=abc123; user=john'
});`,s=`import { RezoCookieJar } from 'rezo';
import rezo from 'rezo';

// Create a cookie jar for persistence
const myJar = new RezoCookieJar();

// Pass jar when creating an instance (recommended)
const client = rezo.create({ jar: myJar });
await client.get('https://example.com/login');
await client.get('https://example.com/dashboard'); // Cookies sent automatically

// Access cookies
const cookies = myJar.getCookiesSync('https://example.com');`,o=`const response = await rezo.get('https://example.com');

// Response cookies are available in multiple formats
const cookies = response.cookies;

cookies.array          // [{name, value, domain, path, ...}]
cookies.serialized     // {name: value, name2: value2}
cookies.netscape       // Netscape format string
cookies.string         // "name=value; name2=value2"
cookies.setCookiesString // "name=value; Path=/; Domain=..."`,r=`// Cookies are automatically merged
// Request cookies + Response cookies = Final result

const myJar = new RezoCookieJar();
const client = rezo.create({ jar: myJar });

// First request sets cookies
await client.get('https://example.com/set-cookies');
// jar now has: session=abc, user=john

// Second request gets new cookies
const response = await client.get('https://example.com/more-cookies');
// If server sets: user=jane, token=xyz

// Response cookies contain merged result:
// session=abc (from request), user=jane (updated), token=xyz (new)`,a=`const myJar = new RezoCookieJar();
const client = rezo.create({ jar: myJar });
// ... make requests ...

// Serialize to JSON for storage
const json = myJar.toJSON();
fs.writeFileSync('cookies.json', JSON.stringify(json));

// Restore from JSON
const saved = JSON.parse(fs.readFileSync('cookies.json', 'utf-8'));
const restoredJar = RezoCookieJar.fromJSON(saved);

// Continue with restored cookies
const client2 = rezo.create({ jar: restoredJar });
await client2.get('https://example.com');`,i=`// Set cookies manually in headers
await rezo.get('https://example.com', {
  headers: {
    'Cookie': 'session=abc123; user=john'
  }
});

// Or use the cookies option (object format)
await rezo.get('https://example.com', {
  cookies: {
    session: 'abc123',
    user: 'john'
  }
});`,c=`import Rezo from 'rezo';

// Create an instance with a cookie jar 
const client = new Rezo();

// Cookies are automatically managed across requests
await client.get('https://example.com/login');
await client.get('https://example.com/dashboard'); // Cookies sent automatically

// Access the instance's global cookie jar
const jar = client.cookieJar;
const allCookies = jar.cookies();
console.log(allCookies.serialized);

// Replace the cookie jar
import { RezoCookieJar } from 'rezo';
client.cookieJar = new RezoCookieJar();

// Save cookies to file
client.saveCookies('./cookies.json');

// Clear all cookies
client.clearCookies();`,l=`import Rezo, { RezoCookieJar } from 'rezo';

// Create instance with existing cookie jar (recommended)
const myJar = new RezoCookieJar();
const client = Rezo.create({ jar: myJar });

// Or load from file
const clientFromFile = Rezo.create({
  cookieFile: './cookies.json'
});

// Cookies are shared across all requests made by this instance
await client.get('https://example.com/login');
await client.get('https://example.com/api'); // Same jar used`;var d=jd();G("2et6jc",Z=>{U(()=>{F.title="Cookie Management - Rezo Documentation"})});var u=n(p(d),6),v=n(p(u),4);f(v,{code:s,language:"typescript"});var h=n(u,2),g=n(p(h),4);f(g,{code:o,language:"typescript"});var y=n(h,2),x=n(p(y),4);f(x,{code:r,language:"typescript"});var b=n(y,2),k=n(p(b),4);f(k,{code:a,language:"typescript"});var w=n(b,2),_=n(p(w),4);f(_,{code:t,language:"typescript"});var S=n(w,2),P=n(p(S),4);f(P,{code:i,language:"typescript"});var I=n(S,2),T=n(p(I),4);f(T,{code:c,language:"typescript"});var A=n(I,2),O=n(p(A),4);f(O,{code:l,language:"typescript"}),E(e,d)}var Fd=N('<div class="space-y-12"><header><h1 class="text-3xl sm:text-4xl font-bold mb-4">Proxy Support</h1> <p class="text-lg" style="color: var(--muted);">Comprehensive proxy support with HTTP, HTTPS, SOCKS4/5, rotation, and health management.</p></header> <section><h2 class="text-2xl font-bold mb-4">Basic Proxy Configuration</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">ProxyManager</h2> <p class="mb-4" style="color: var(--muted);">Advanced proxy rotation and health management:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">URL Filtering</h2> <p class="mb-4" style="color: var(--muted);">Control which URLs use proxies:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Proxy Lifecycle Hooks</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Rotation Strategies</h2> <div class="grid sm:grid-cols-3 gap-4"><div class="p-4 rounded-lg" style="background-color: var(--surface);"><h4 class="font-semibold mb-2">random</h4> <p class="text-sm" style="color: var(--muted);">Randomly select from healthy proxies</p></div> <div class="p-4 rounded-lg" style="background-color: var(--surface);"><h4 class="font-semibold mb-2">sequential</h4> <p class="text-sm" style="color: var(--muted);">Round-robin through proxies in order</p></div> <div class="p-4 rounded-lg" style="background-color: var(--surface);"><h4 class="font-semibold mb-2">per-proxy-limit</h4> <p class="text-sm" style="color: var(--muted);">Limit requests per proxy before rotating</p></div></div></section></div>');function $d(e){const t=`// HTTP proxy
await rezo.get('https://api.example.com', {
  proxy: {
    host: 'proxy.example.com',
    port: 8080
  }
});

// HTTPS proxy
await rezo.get('https://api.example.com', {
  proxy: {
    host: 'proxy.example.com',
    port: 8080,
    protocol: 'https'
  }
});

// SOCKS5 proxy
await rezo.get('https://api.example.com', {
  proxy: {
    host: 'socks.example.com',
    port: 1080,
    protocol: 'socks5'
  }
});

// Authenticated proxy
await rezo.get('https://api.example.com', {
  proxy: {
    host: 'proxy.example.com',
    port: 8080,
    auth: {
      username: 'user',
      password: 'pass'
    }
  }
});`,s=`import { ProxyManager } from 'rezo';

// Create a proxy manager with multiple proxies
const manager = new ProxyManager({
  proxies: [
    { host: 'proxy1.example.com', port: 8080 },
    { host: 'proxy2.example.com', port: 8080 },
    { host: 'proxy3.example.com', port: 8080 },
  ],
  
  // Rotation strategy
  strategy: 'random',  // or 'sequential', 'per-proxy-limit'
  
  // Health checking
  failureThreshold: 3,     // Mark dead after 3 failures
  cooldownPeriod: 60000,   // Re-enable after 60 seconds
});

// Use with rezo
const api = rezo.create({
  proxyManager: manager
});

await api.get('https://api.example.com'); // Uses rotating proxies`,o=`const manager = new ProxyManager({
  proxies: [...],
  
  // Only use proxy for specific URLs
  whitelist: [
    '*.target-site.com',
    'api.specific-domain.com'
  ],
  
  // Never use proxy for these
  blacklist: [
    '*.internal.company.com',
    'localhost',
    /^192\\.168\\./  // Regex pattern
  ]
});`,r=`const manager = new ProxyManager({
  proxies: [...],
  
  hooks: {
    beforeProxySelect: (url, proxies) => {
      console.log(\`Selecting proxy for \${url}\`);
    },
    
    afterProxySelect: (url, proxy) => {
      console.log(\`Selected: \${proxy.host}\`);
    },
    
    beforeProxyError: (proxy, error) => {
      console.log(\`Proxy error: \${proxy.host}\`);
    },
    
    onProxyDead: (proxy) => {
      console.log(\`Proxy marked dead: \${proxy.host}\`);
      // Optionally notify monitoring system
    },
    
    onProxyRevived: (proxy) => {
      console.log(\`Proxy revived: \${proxy.host}\`);
    }
  }
});`;var a=Fd();G("qvb5xj",y=>{U(()=>{F.title="Proxy Configuration - Rezo Documentation"})});var i=n(p(a),2),c=n(p(i),2);f(c,{code:t,language:"typescript"});var l=n(i,2),d=n(p(l),4);f(d,{code:s,language:"typescript"});var u=n(l,2),v=n(p(u),4);f(v,{code:o,language:"typescript"});var h=n(u,2),g=n(p(h),2);f(g,{code:r,language:"typescript"}),E(e,a)}var Gd=N(`<article class="prose svelte-x7ktnm"><h1 class="svelte-x7ktnm">ProxyManager</h1> <p class="lead svelte-x7ktnm">ProxyManager provides advanced proxy rotation and pool management with multiple rotation strategies, failure handling, URL filtering, and comprehensive lifecycle hooks.</p> <h2 class="svelte-x7ktnm">Overview</h2> <p class="svelte-x7ktnm">While basic proxy configuration works for single-proxy setups, ProxyManager is designed for enterprise scenarios where you need to manage a pool of proxies with automatic rotation, failure detection, and intelligent URL-based routing.</p> <h2 class="svelte-x7ktnm">Basic Setup</h2> <!> <h2 class="svelte-x7ktnm">Rotation Strategies</h2> <h3 class="svelte-x7ktnm">Random Rotation</h3> <p class="svelte-x7ktnm">Randomly selects a proxy from the available pool for each request.</p> <!> <h3 class="svelte-x7ktnm">Sequential Rotation</h3> <p class="svelte-x7ktnm">Uses proxies in order, optionally rotating after N requests per proxy.</p> <!> <h3 class="svelte-x7ktnm">Per-Proxy Limit</h3> <p class="svelte-x7ktnm">Uses each proxy for a maximum number of total requests, then permanently removes it.</p> <!> <h2 class="svelte-x7ktnm">URL Filtering</h2> <h3 class="svelte-x7ktnm">Whitelist</h3> <p class="svelte-x7ktnm">Only use proxies for specific domains or URL patterns.</p> <!> <h3 class="svelte-x7ktnm">Blacklist</h3> <p class="svelte-x7ktnm">Exclude certain domains from proxy usage (direct connection).</p> <!> <h2 class="svelte-x7ktnm">Failure Handling</h2> <h3 class="svelte-x7ktnm">Auto-Disable Dead Proxies</h3> <!> <h3 class="svelte-x7ktnm">Cooldown Period</h3> <p class="svelte-x7ktnm">Re-enable disabled proxies after a cooldown period.</p> <!> <h3 class="svelte-x7ktnm">Retry with Next Proxy</h3> <!> <h2 class="svelte-x7ktnm">ProxyManager Hooks</h2> <p class="svelte-x7ktnm">ProxyManager provides 9 lifecycle hooks for monitoring and controlling proxy behavior.</p> <table class="svelte-x7ktnm"><thead><tr><th class="svelte-x7ktnm">Hook</th><th class="svelte-x7ktnm">Description</th></tr></thead><tbody><tr><td class="svelte-x7ktnm"><code class="svelte-x7ktnm">beforeProxySelect</code></td><td class="svelte-x7ktnm">Called before selecting a proxy. Can return a specific proxy to use.</td></tr><tr><td class="svelte-x7ktnm"><code class="svelte-x7ktnm">afterProxySelect</code></td><td class="svelte-x7ktnm">Called after a proxy is selected for a request.</td></tr><tr><td class="svelte-x7ktnm"><code class="svelte-x7ktnm">beforeProxyError</code></td><td class="svelte-x7ktnm">Called before a proxy error is processed.</td></tr><tr><td class="svelte-x7ktnm"><code class="svelte-x7ktnm">afterProxyError</code></td><td class="svelte-x7ktnm">Called after a proxy error has been processed.</td></tr><tr><td class="svelte-x7ktnm"><code class="svelte-x7ktnm">beforeProxyDisable</code></td><td class="svelte-x7ktnm">Called before disabling a proxy. Return false to prevent.</td></tr><tr><td class="svelte-x7ktnm"><code class="svelte-x7ktnm">afterProxyDisable</code></td><td class="svelte-x7ktnm">Called after a proxy has been disabled.</td></tr><tr><td class="svelte-x7ktnm"><code class="svelte-x7ktnm">afterProxyRotate</code></td><td class="svelte-x7ktnm">Called after rotating to a new proxy.</td></tr><tr><td class="svelte-x7ktnm"><code class="svelte-x7ktnm">afterProxyEnable</code></td><td class="svelte-x7ktnm">Called when a proxy is re-enabled (after cooldown).</td></tr><tr><td class="svelte-x7ktnm"><code class="svelte-x7ktnm">onNoProxiesAvailable</code></td><td class="svelte-x7ktnm">Called when no proxies are available. Use for alerts or pool refresh.</td></tr></tbody></table> <h3 class="svelte-x7ktnm">Hook Examples</h3> <!> <h2 class="svelte-x7ktnm">Configuration Reference</h2> <table class="svelte-x7ktnm"><thead><tr><th class="svelte-x7ktnm">Option</th><th class="svelte-x7ktnm">Type</th><th class="svelte-x7ktnm">Default</th><th class="svelte-x7ktnm">Description</th></tr></thead><tbody><tr><td class="svelte-x7ktnm"><code class="svelte-x7ktnm">proxies</code></td><td class="svelte-x7ktnm"><code class="svelte-x7ktnm">(ProxyInfo | string)[]</code></td><td class="svelte-x7ktnm">Required</td><td class="svelte-x7ktnm">Array of proxy configurations or URL strings</td></tr><tr><td class="svelte-x7ktnm"><code class="svelte-x7ktnm">rotation</code></td><td class="svelte-x7ktnm"><code class="svelte-x7ktnm">'random' | 'sequential' | 'per-proxy-limit'</code></td><td class="svelte-x7ktnm">Required</td><td class="svelte-x7ktnm">Rotation strategy</td></tr><tr><td class="svelte-x7ktnm"><code class="svelte-x7ktnm">whitelist</code></td><td class="svelte-x7ktnm"><code class="svelte-x7ktnm">(string | RegExp)[]</code></td><td class="svelte-x7ktnm">undefined</td><td class="svelte-x7ktnm">URLs that should use proxy</td></tr><tr><td class="svelte-x7ktnm"><code class="svelte-x7ktnm">blacklist</code></td><td class="svelte-x7ktnm"><code class="svelte-x7ktnm">(string | RegExp)[]</code></td><td class="svelte-x7ktnm">undefined</td><td class="svelte-x7ktnm">URLs that bypass proxy</td></tr><tr><td class="svelte-x7ktnm"><code class="svelte-x7ktnm">autoDisableDeadProxies</code></td><td class="svelte-x7ktnm"><code class="svelte-x7ktnm">boolean</code></td><td class="svelte-x7ktnm">false</td><td class="svelte-x7ktnm">Auto-disable failing proxies</td></tr><tr><td class="svelte-x7ktnm"><code class="svelte-x7ktnm">maxFailures</code></td><td class="svelte-x7ktnm"><code class="svelte-x7ktnm">number</code></td><td class="svelte-x7ktnm">3</td><td class="svelte-x7ktnm">Failures before disabling</td></tr><tr><td class="svelte-x7ktnm"><code class="svelte-x7ktnm">cooldown</code></td><td class="svelte-x7ktnm"><code class="svelte-x7ktnm">ProxyCooldownConfig</code></td><td class="svelte-x7ktnm">undefined</td><td class="svelte-x7ktnm">Re-enable config after cooldown</td></tr><tr><td class="svelte-x7ktnm"><code class="svelte-x7ktnm">failWithoutProxy</code></td><td class="svelte-x7ktnm"><code class="svelte-x7ktnm">boolean</code></td><td class="svelte-x7ktnm">true</td><td class="svelte-x7ktnm">Throw error if no proxy available</td></tr><tr><td class="svelte-x7ktnm"><code class="svelte-x7ktnm">retryWithNextProxy</code></td><td class="svelte-x7ktnm"><code class="svelte-x7ktnm">boolean</code></td><td class="svelte-x7ktnm">false</td><td class="svelte-x7ktnm">Retry failed requests with next proxy</td></tr><tr><td class="svelte-x7ktnm"><code class="svelte-x7ktnm">maxProxyRetries</code></td><td class="svelte-x7ktnm"><code class="svelte-x7ktnm">number</code></td><td class="svelte-x7ktnm">3</td><td class="svelte-x7ktnm">Max proxy retry attempts</td></tr></tbody></table> <h2 class="svelte-x7ktnm">Bypassing ProxyManager</h2> <p class="svelte-x7ktnm">You can bypass the ProxyManager for specific requests:</p> <!></article>`);function Jd(e){var t=Gd();G("x7ktnm",g=>{U(()=>{F.title="ProxyManager - Rezo Documentation"})});var s=n(p(t),10);f(s,{code:`import { Rezo, ProxyManager } from 'rezo';

const proxyManager = new ProxyManager({
  rotation: 'random',
  proxies: [
    { protocol: 'http', host: 'proxy1.example.com', port: 8080 },
    { protocol: 'socks5', host: 'proxy2.example.com', port: 1080 },
    'http://user:pass@proxy3.example.com:8080'
  ]
});

const client = new Rezo({
  proxyManager
});

// All requests automatically use the proxy pool
const response = await client.get('https://api.example.com/data');`,language:"typescript"});var o=n(s,8);f(o,{code:`const manager = new ProxyManager({
  rotation: 'random',
  proxies: [/* ... */]
});`,language:"typescript"});var r=n(o,6);f(r,{code:`const manager = new ProxyManager({
  rotation: 'sequential',
  requestsPerProxy: 10, // Rotate after 10 requests
  proxies: [/* ... */]
});`,language:"typescript"});var a=n(r,6);f(a,{code:`const manager = new ProxyManager({
  rotation: 'per-proxy-limit',
  limit: 100, // Each proxy handles max 100 requests
  proxies: [/* ... */]
});`,language:"typescript"});var i=n(a,8);f(i,{code:`const manager = new ProxyManager({
  rotation: 'random',
  proxies: [/* ... */],
  whitelist: [
    'api.example.com',           // Exact domain match
    /^\\/api\\//,                  // Regex pattern
    /^https:\\/\\/secure\\./       // URLs starting with https://secure.
  ]
});`,language:"typescript"});var c=n(i,6);f(c,{code:`const manager = new ProxyManager({
  rotation: 'random',
  proxies: [/* ... */],
  blacklist: [
    'localhost',
    '127.0.0.1',
    /\\.internal\\./
  ]
});`,language:"typescript"});var l=n(c,6);f(l,{code:`const manager = new ProxyManager({
  rotation: 'random',
  proxies: [/* ... */],
  autoDisableDeadProxies: true,
  maxFailures: 3 // Disable after 3 consecutive failures
});`,language:"typescript"});var d=n(l,6);f(d,{code:`const manager = new ProxyManager({
  rotation: 'random',
  proxies: [/* ... */],
  autoDisableDeadProxies: true,
  maxFailures: 3,
  cooldown: {
    enabled: true,
    durationMs: 60000 // Re-enable after 1 minute
  }
});`,language:"typescript"});var u=n(d,4);f(u,{code:`const manager = new ProxyManager({
  rotation: 'random',
  proxies: [/* ... */],
  retryWithNextProxy: true,
  maxProxyRetries: 3
});`,language:"typescript"});var v=n(u,10);f(v,{code:`const manager = new ProxyManager({
  rotation: 'random',
  proxies: [/* ... */]
});

// Log when proxy is selected
manager.hooks.afterProxySelect.push(({ proxy, url }) => {
  console.log(\`Using \${proxy.host}:\${proxy.port} for \${url}\`);
});

// Alert when proxies are exhausted
manager.hooks.onNoProxiesAvailable.push(({ reason }) => {
  console.error('No proxies available:', reason);
  // Trigger alert or refresh proxy pool
});

// Prevent disabling certain proxies
manager.hooks.beforeProxyDisable.push(({ proxy }) => {
  if (proxy.label === 'premium') {
    return false; // Don't disable premium proxies
  }
});

// Log proxy failures
manager.hooks.afterProxyError.push(({ proxy, error, failureCount }) => {
  console.warn(\`Proxy \${proxy.host} failed (\${failureCount}x): \${error.message}\`);
});`,language:"typescript"});var h=n(v,10);f(h,{code:`// Use direct connection for this request
const response = await client.get('https://api.example.com/data', {
  useProxyManager: false
});

// Use a specific proxy instead of the manager
const response2 = await client.get('https://api.example.com/data', {
  useProxyManager: false,
  proxy: 'http://specific-proxy.com:8080'
});`,language:"typescript"}),E(e,t)}var Wd=N('<div class="space-y-12"><header><h1 class="text-3xl sm:text-4xl font-bold mb-4">Streaming</h1> <p class="text-lg" style="color: var(--muted);">Memory-efficient streaming for large file downloads, uploads, and data processing.</p></header> <section><h2 class="text-2xl font-bold mb-4">Stream Response</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Download with Progress</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Upload with Progress</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Stream Request Body</h2> <!></section></div>');function Zd(e){const t=`// Get a streaming response
const stream = await rezo.getStream('https://example.com/large-file');

stream.on('data', (chunk) => {
  console.log('Received:', chunk.length, 'bytes');
  processChunk(chunk);
});

stream.on('end', () => {
  console.log('Stream complete');
});

stream.on('error', (error) => {
  console.error('Stream error:', error);
});`,s=`// Download file with progress
const download = await rezo.download(
  'https://example.com/video.mp4',
  './downloads/video.mp4'
);

download.on('progress', (progress) => {
  console.log(\`Downloaded: \${progress.percent}%\`);
  console.log(\`Speed: \${progress.speed} bytes/sec\`);
  console.log(\`ETA: \${progress.eta} seconds\`);
});

download.on('complete', (stats) => {
  console.log('Download complete!');
  console.log(\`Total: \${stats.totalBytes} bytes\`);
  console.log(\`Duration: \${stats.duration}ms\`);
});

download.on('error', (error) => {
  console.error('Download failed:', error);
});`,o=`import { RezoFormData } from 'rezo';

const form = new RezoFormData();
form.append('video', fs.createReadStream('./large-video.mp4'));

const upload = await rezo.upload('https://api.example.com/upload', form);

upload.on('progress', (progress) => {
  console.log(\`Uploaded: \${progress.percent}%\`);
  console.log(\`Speed: \${progress.speed} bytes/sec\`);
});

upload.on('complete', (response) => {
  console.log('Upload complete!');
  console.log('Server response:', response.data);
});`,r=`import { createReadStream } from 'fs';

// Stream a file as request body
const stream = createReadStream('./large-data.json');

await rezo.post('https://api.example.com/import', stream, {
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': String(fs.statSync('./large-data.json').size)
  }
});`;var a=Wd();G("1wnuewn",y=>{U(()=>{F.title="Streaming Responses - Rezo Documentation"})});var i=n(p(a),2),c=n(p(i),2);f(c,{code:t,language:"typescript"});var l=n(i,2),d=n(p(l),2);f(d,{code:s,language:"typescript"});var u=n(l,2),v=n(p(u),2);f(v,{code:o,language:"typescript"});var h=n(u,2),g=n(p(h),2);f(g,{code:r,language:"typescript"}),E(e,a)}var Vd=N('<div class="space-y-12"><header><h1 class="text-3xl sm:text-4xl font-bold mb-4">Retry & Backoff</h1> <p class="text-lg" style="color: var(--muted);">Intelligent retry logic with exponential backoff and custom conditions.</p></header> <section><h2 class="text-2xl font-bold mb-4">Basic Retry</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Conditional Retry</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Retry-After Header</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Retry Hooks</h2> <!></section></div>');function Kd(e){const t=`// Simple retry configuration
await rezo.get('https://api.example.com/data', {
  retry: {
    attempts: 3,          // Max retry attempts
    delay: 1000,          // Initial delay (ms)
    multiplier: 2,        // Exponential backoff
    statusCodes: [500, 502, 503, 504]  // Retry these
  }
});

// Flow:
// 1. Request fails with 503
// 2. Wait 1000ms, retry
// 3. Fails again → wait 2000ms, retry
// 4. Fails again → wait 4000ms, retry
// 5. Still fails → throw RezoError`,s=`await rezo.get('https://api.example.com/data', {
  retry: {
    attempts: 5,
    delay: 500,
    
    // Only retry specific status codes
    statusCodes: [429, 500, 502, 503, 504],
    
    // Only retry safe methods by default
    methods: ['GET', 'HEAD', 'OPTIONS'],
    
    // Custom condition
    condition: (error) => {
      // Don't retry auth errors
      if (error.status === 401) return false;
      
      // Retry network errors
      if (error.isNetworkError) return true;
      
      // Custom logic
      return error.isRetryable;
    }
  }
});`,o=`// Automatic Retry-After header support
await rezo.get('https://api.example.com/rate-limited', {
  retry: {
    attempts: 3,
    respectRetryAfter: true  // Honor Retry-After header
  }
});

// If server returns:
// HTTP/1.1 429 Too Many Requests
// Retry-After: 60
//
// Rezo waits 60 seconds before retrying`,r=`await rezo.get('https://api.example.com/data', {
  retry: {
    attempts: 3,
    delay: 1000
  },
  
  hooks: {
    beforeRetry: [(options, error, retryCount) => {
      console.log(\`Retry attempt \${retryCount}\`);
      console.log(\`Failed with: \${error.message}\`);
      
      // Optionally modify options before retry
      options.headers['X-Retry-Attempt'] = String(retryCount);
      
      return options;
    }]
  }
});`;var a=Vd();G("1xo9fol",y=>{U(()=>{F.title="Retry Logic - Rezo Documentation"})});var i=n(p(a),2),c=n(p(i),2);f(c,{code:t,language:"typescript"});var l=n(i,2),d=n(p(l),2);f(d,{code:s,language:"typescript"});var u=n(l,2),v=n(p(u),2);f(v,{code:o,language:"typescript"});var h=n(u,2),g=n(p(h),2);f(g,{code:r,language:"typescript"}),E(e,a)}var Xd=N('<div class="space-y-12"><header><h1 class="text-3xl sm:text-4xl font-bold mb-4">Hooks System</h1> <p class="text-lg" style="color: var(--muted);">Comprehensive lifecycle hooks for request/response interception, network monitoring, caching control, and cookie management.</p></header> <section><h2 class="text-2xl font-bold mb-4">Overview</h2> <p class="mb-4" style="color: var(--muted);">Rezo provides 24+ hooks covering the entire request lifecycle:</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Request Lifecycle Hooks</h2> <div class="space-y-8"><div><h3 class="text-xl font-semibold mb-3">beforeRequest</h3> <p class="mb-4" style="color: var(--muted);">Called before the request is sent. Modify config, add headers, or return early with a Response to bypass the actual request.</p> <!></div> <div><h3 class="text-xl font-semibold mb-3">afterResponse</h3> <p class="mb-4" style="color: var(--muted);">Called after the response is received. Transform data, trigger retries with merged options, or modify the response.</p> <!></div> <div><h3 class="text-xl font-semibold mb-3">beforeError</h3> <p class="mb-4" style="color: var(--muted);">Called before an error is thrown. Transform errors, add context, or log to monitoring services.</p> <!></div> <div><h3 class="text-xl font-semibold mb-3">beforeRetry</h3> <p class="mb-4" style="color: var(--muted);">Called before a retry attempt. Implement custom backoff, refresh credentials, or modify config.</p> <!></div></div></section> <section><h2 class="text-2xl font-bold mb-4">Network Event Hooks</h2> <p class="mb-4" style="color: var(--muted);">Monitor low-level network events for debugging and performance analysis.</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Cache Hooks</h2> <p class="mb-4" style="color: var(--muted);">Control which responses get cached.</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Cookie Hooks</h2> <p class="mb-4" style="color: var(--muted);">Intercept cookie processing to filter, validate, or log cookies.</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Per-Request Hooks</h2> <p class="mb-4" style="color: var(--muted);">Hooks can be set per-request in addition to instance-level hooks.</p> <!></section> <section><h2 class="text-2xl font-bold mb-4">Hook Reference</h2> <p class="mb-4 text-sm" style="color: var(--muted); font-style: italic;">Async-capable hooks can return a Promise. Event hooks (on*) are synchronous only.</p> <div class="overflow-x-auto"><table class="w-full text-sm" style="border-collapse: collapse;"><thead><tr style="background: var(--surface);"><th class="p-3 text-left font-semibold" style="border-bottom: 1px solid var(--border);">Hook</th><th class="p-3 text-left font-semibold" style="border-bottom: 1px solid var(--border);">Parameters</th><th class="p-3 text-left font-semibold" style="border-bottom: 1px solid var(--border);">Return Type</th></tr></thead><tbody><tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">init</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">(plainOptions, options)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">void</code></td></tr><tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">beforeRequest</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">(config, context)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">void | Response | Promise&lt;void | Response&gt;</code></td></tr><tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">beforeRedirect</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">(config, response)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">void | Promise&lt;void&gt;</code></td></tr><tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">beforeRetry</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">(config, error, retryCount)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">void | Promise&lt;void&gt;</code></td></tr><tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">afterResponse</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">(response, config, context)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">RezoResponse&lt;T&gt; | Promise&lt;...&gt;</code></td></tr><tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">afterHeaders</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">(event, config)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">void | Promise&lt;void&gt;</code></td></tr><tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">afterParse</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">(event, config)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">T | Promise&lt;T&gt;</code></td></tr><tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">beforeError</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">(error)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">RezoError | Error | Promise&lt;...&gt;</code></td></tr><tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">beforeCache</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">(event)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">boolean | void</code></td></tr><tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">beforeCookie</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">(event, config)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">boolean | void | Promise&lt;...&gt;</code></td></tr><tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">afterCookie</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">(cookies, config)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">void | Promise&lt;void&gt;</code></td></tr><tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">onSocket</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">(event, socket)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">void</code></td></tr><tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">onDns</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">(event, config)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">void</code></td></tr><tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">onTls</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">(event, config)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">void</code></td></tr><tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">onTimeout</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">(event, config)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">void</code></td></tr><tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">onAbort</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">(event, config)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">void</code></td></tr></tbody></table></div></section> <section><h3 class="text-xl font-semibold mb-4">Proxy Hooks</h3> <div class="overflow-x-auto"><table class="w-full text-sm" style="border-collapse: collapse;"><thead><tr style="background: var(--surface);"><th class="p-3 text-left font-semibold" style="border-bottom: 1px solid var(--border);">Hook</th><th class="p-3 text-left font-semibold" style="border-bottom: 1px solid var(--border);">Parameters</th><th class="p-3 text-left font-semibold" style="border-bottom: 1px solid var(--border);">Return Type</th></tr></thead><tbody><tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">beforeProxySelect</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">(context)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">ProxyInfo | void | Promise&lt;...&gt;</code></td></tr><tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">afterProxySelect</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">(context)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">void | Promise&lt;void&gt;</code></td></tr><tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">beforeProxyError</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">(context)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">void | Promise&lt;void&gt;</code></td></tr><tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">afterProxyError</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">(context)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">void | Promise&lt;void&gt;</code></td></tr><tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">beforeProxyDisable</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">(context)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">boolean | void | Promise&lt;...&gt;</code></td></tr><tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">afterProxyDisable</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">(context)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">void | Promise&lt;void&gt;</code></td></tr><tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">afterProxyRotate</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">(context)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">void | Promise&lt;void&gt;</code></td></tr><tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">afterProxyEnable</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">(context)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">void | Promise&lt;void&gt;</code></td></tr><tr><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">onNoProxiesAvailable</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">(context)</code></td><td class="p-3" style="border-bottom: 1px solid var(--border);"><code class="svelte-1x7609v">void | Promise&lt;void&gt;</code></td></tr></tbody></table></div></section> <section class="tip-box svelte-1x7609v"><h3 class="text-lg font-semibold mb-2">Tips</h3> <ul class="list-disc ml-5 space-y-1" style="color: var(--muted);"><li>Most hooks support async handlers and can return Promises</li> <li>Event hooks (<code class="svelte-1x7609v">onSocket</code>, <code class="svelte-1x7609v">onDns</code>, <code class="svelte-1x7609v">onTls</code>, <code class="svelte-1x7609v">onTimeout</code>, <code class="svelte-1x7609v">onAbort</code>) are synchronous only</li> <li>Arrays of hooks run in order</li></ul></section></div>');function Qd(e){const t=`import { Rezo } from 'rezo';

const client = new Rezo({
  hooks: {
    // Request lifecycle
    init: [],              // Options initialization
    beforeRequest: [],     // Before request is sent
    beforeRedirect: [],    // Before following a redirect
    beforeRetry: [],       // Before retry attempt
    
    // Response lifecycle  
    afterResponse: [],     // After response received
    afterHeaders: [],      // When headers received (before body)
    afterParse: [],        // After response body is parsed
    
    // Error handling
    beforeError: [],       // Before error is thrown
    
    // Cache events
    beforeCache: [],       // Before caching response
    
    // Cookie events
    beforeCookie: [],      // Before setting a cookie
    afterCookie: [],       // After cookies processed
    
    // Proxy hooks (9 hooks for ProxyManager)
    beforeProxySelect: [], // Before proxy selection
    afterProxySelect: [],  // After proxy selected
    beforeProxyError: [],  // Before handling proxy error
    afterProxyError: [],   // After proxy error processed
    beforeProxyDisable: [],// Before disabling a proxy
    afterProxyDisable: [], // After proxy disabled
    afterProxyRotate: [],  // After proxy rotation
    afterProxyEnable: [],  // After proxy re-enabled
    onNoProxiesAvailable: [], // When proxy pool exhausted
    
    // Network events
    onSocket: [],          // Socket events (connect, close, error)
    onDns: [],             // DNS resolution events
    onTls: [],             // TLS handshake events
    onTimeout: [],         // Timeout events
    onAbort: []            // Request abort events
  }
});`,s=`// Modify request before sending
const client = new Rezo({
  hooks: {
    beforeRequest: [
      (config, context) => {
        // context: { retryCount, isRedirect, redirectCount, startTime }
        
        // Add authentication (config.headers is a RezoHeaders instance)
        const token = getAuthToken();
        config.headers = {
          ...config.headers,
          'Authorization': \`Bearer \${token}\`,
          'X-Request-ID': crypto.randomUUID()
        };
        
        // Return early with cached response (bypass actual request)
        // return new Response('cached data');
      }
    ]
  }
});`,o=`// Transform or retry after response
const client = new Rezo({
  hooks: {
    afterResponse: [
      async (response, config, context) => {
        // context: { retryCount, retryWithMergedOptions }
        
        // Unwrap API envelope
        if (response.data?.result) {
          response.data = response.data.result;
        }
        
        // Token refresh on 401
        if (response.status === 401) {
          const newToken = await refreshToken();
          context.retryWithMergedOptions({
            headers: { Authorization: \`Bearer \${newToken}\` }
          });
        }
        
        return response;
      }
    ]
  }
});`,r=`// Transform errors before throwing
const client = new Rezo({
  hooks: {
    beforeError: [
      (error) => {
        // Add user-friendly message
        if (error.status === 404) {
          error.message = 'Resource not found';
        }
        
        // Log to monitoring service
        errorMonitor.capture(error);
        
        // Return modified error (will be thrown)
        return error;
      }
    ]
  }
});`,a=`// Monitor network events
const client = new Rezo({
  hooks: {
    onDns: [
      (event, config) => {
        // event: { hostname, address, family, duration, timestamp }
        console.log(\`DNS resolved \${event.hostname} to \${event.address} in \${event.duration}ms\`);
      }
    ],
    
    onTls: [
      (event, config) => {
        // event: { protocol, cipher, authorized, certificate, duration }
        console.log(\`TLS \${event.protocol} handshake in \${event.duration}ms\`);
        if (!event.authorized) {
          console.warn('Certificate not authorized:', event.authorizationError);
        }
      }
    ],
    
    onSocket: [
      (event, socket) => {
        // event.type: 'connect' | 'close' | 'drain' | 'error' | 'timeout' | 'end'
        console.log(\`Socket \${event.type} - bytes: \${event.bytesRead}/\${event.bytesWritten}\`);
      }
    ]
  }
});`,i=`// Control caching behavior
const client = new Rezo({
  cache: true,
  hooks: {
    beforeCache: [
      (event) => {
        // event: { status, headers, url, cacheKey, isCacheable, cacheControl }
        
        // Don't cache error responses
        if (event.status >= 400) return false;
        
        // Don't cache if no-store directive
        if (event.cacheControl?.noStore) return false;
        
        // Cache is allowed
        return true;
      }
    ]
  }
});`,c=`// Intercept cookie processing
const client = new Rezo({
  hooks: {
    beforeCookie: [
      (event, config) => {
        // event: { cookie, source, url, isValid, validationErrors }
        
        // Reject tracking cookies
        if (event.cookie.key.startsWith('_ga')) {
          return false; // Cookie will not be set
        }
        
        // Allow cookie
        return true;
      }
    ],
    
    afterCookie: [
      (cookies, config) => {
        // cookies: Array of Cookie objects
        console.log(\`Processed \${cookies.length} cookies\`);
      }
    ]
  }
});`,l=`// Custom retry logic
const client = new Rezo({
  retry: { maxRetries: 3 },
  hooks: {
    beforeRetry: [
      async (config, error, retryCount) => {
        console.log(\`Retry attempt \${retryCount} for \${config.url}\`);
        
        // Custom backoff delay
        await new Promise(r => setTimeout(r, retryCount * 1000));
        
        // Refresh credentials before retry
        if (error.status === 401) {
          config.headers = {
            ...config.headers,
            'Authorization': await getNewToken()
          };
        }
      }
    ]
  }
});`,d=`// Hooks can also be set per-request
const response = await rezo.get('https://api.example.com/data', {
  hooks: {
    beforeRequest: [
      (config, context) => {
        config.headers = { ...config.headers, 'X-Custom': 'value' };
      }
    ],
    afterResponse: [
      (response, config, context) => {
        console.log('Request completed:', response.status);
        return response;
      }
    ]
  }
});`;var u=Xd();G("1x7609v",ie=>{U(()=>{F.title="Hooks System - Rezo Documentation"})});var v=n(p(u),2),h=n(p(v),4);f(h,{code:t,language:"typescript"});var g=n(v,2),y=n(p(g),2),x=p(y),b=n(p(x),4);f(b,{code:s,language:"typescript"});var k=n(x,2),w=n(p(k),4);f(w,{code:o,language:"typescript"});var _=n(k,2),S=n(p(_),4);f(S,{code:r,language:"typescript"});var P=n(_,2),I=n(p(P),4);f(I,{code:l,language:"typescript"});var T=n(g,2),A=n(p(T),4);f(A,{code:a,language:"typescript"});var O=n(T,2),Z=n(p(O),4);f(Z,{code:i,language:"typescript"});var K=n(O,2),J=n(p(K),4);f(J,{code:c,language:"typescript"});var ye=n(K,2),oe=n(p(ye),4);f(oe,{code:d,language:"typescript"}),E(e,u)}var Yd=N('<div class="space-y-12"><header><h1 class="text-3xl sm:text-4xl font-bold mb-4">Queue & Rate Limiting</h1> <p class="text-lg" style="color: var(--muted);">Built-in request queuing with priority, concurrency limits, and rate limiting.</p></header> <section class="info-box svelte-1ebbyds"><h3 class="text-lg font-semibold mb-2">Two Queue Types</h3> <ul class="list-disc ml-5 space-y-1" style="color: var(--muted);"><li><strong>RezoQueue</strong> - General-purpose priority queue with concurrency control</li> <li><strong>HttpQueue</strong> - HTTP-aware queue with per-domain limits, rate limit header parsing, and auto-retry</li></ul></section> <section><h2 class="text-2xl font-bold mb-4">Basic Queue</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">HTTP-Aware Queue</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Priority Levels</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Queue Events</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Queue Control</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Configuration Reference</h2> <h3 class="text-lg font-semibold mb-2">RezoQueue Config</h3> <table class="svelte-1ebbyds"><thead><tr><th class="svelte-1ebbyds">Option</th><th class="svelte-1ebbyds">Type</th><th class="svelte-1ebbyds">Default</th><th class="svelte-1ebbyds">Description</th></tr></thead><tbody><tr><td class="svelte-1ebbyds"><code class="svelte-1ebbyds">concurrency</code></td><td class="svelte-1ebbyds"><code class="svelte-1ebbyds">number</code></td><td class="svelte-1ebbyds">Infinity</td><td class="svelte-1ebbyds">Max concurrent tasks</td></tr><tr><td class="svelte-1ebbyds"><code class="svelte-1ebbyds">interval</code></td><td class="svelte-1ebbyds"><code class="svelte-1ebbyds">number</code></td><td class="svelte-1ebbyds">0</td><td class="svelte-1ebbyds">Rate limit interval (ms)</td></tr><tr><td class="svelte-1ebbyds"><code class="svelte-1ebbyds">intervalCap</code></td><td class="svelte-1ebbyds"><code class="svelte-1ebbyds">number</code></td><td class="svelte-1ebbyds">Infinity</td><td class="svelte-1ebbyds">Max tasks per interval</td></tr><tr><td class="svelte-1ebbyds"><code class="svelte-1ebbyds">timeout</code></td><td class="svelte-1ebbyds"><code class="svelte-1ebbyds">number</code></td><td class="svelte-1ebbyds">0</td><td class="svelte-1ebbyds">Task timeout (ms)</td></tr><tr><td class="svelte-1ebbyds"><code class="svelte-1ebbyds">throwOnTimeout</code></td><td class="svelte-1ebbyds"><code class="svelte-1ebbyds">boolean</code></td><td class="svelte-1ebbyds">true</td><td class="svelte-1ebbyds">Throw on timeout</td></tr><tr><td class="svelte-1ebbyds"><code class="svelte-1ebbyds">autoStart</code></td><td class="svelte-1ebbyds"><code class="svelte-1ebbyds">boolean</code></td><td class="svelte-1ebbyds">true</td><td class="svelte-1ebbyds">Auto-start processing</td></tr></tbody></table> <h3 class="text-lg font-semibold mb-2 mt-6">HttpQueue Config (extends RezoQueue)</h3> <table class="svelte-1ebbyds"><thead><tr><th class="svelte-1ebbyds">Option</th><th class="svelte-1ebbyds">Type</th><th class="svelte-1ebbyds">Default</th><th class="svelte-1ebbyds">Description</th></tr></thead><tbody><tr><td class="svelte-1ebbyds"><code class="svelte-1ebbyds">domainConcurrency</code></td><td class="svelte-1ebbyds"><code class="svelte-1ebbyds">number | object</code></td><td class="svelte-1ebbyds">Infinity</td><td class="svelte-1ebbyds">Per-domain concurrency limit</td></tr><tr><td class="svelte-1ebbyds"><code class="svelte-1ebbyds">requestsPerSecond</code></td><td class="svelte-1ebbyds"><code class="svelte-1ebbyds">number</code></td><td class="svelte-1ebbyds">0</td><td class="svelte-1ebbyds">Rate limit requests per second</td></tr><tr><td class="svelte-1ebbyds"><code class="svelte-1ebbyds">respectRetryAfter</code></td><td class="svelte-1ebbyds"><code class="svelte-1ebbyds">boolean</code></td><td class="svelte-1ebbyds">true</td><td class="svelte-1ebbyds">Honor Retry-After header</td></tr><tr><td class="svelte-1ebbyds"><code class="svelte-1ebbyds">respectRateLimitHeaders</code></td><td class="svelte-1ebbyds"><code class="svelte-1ebbyds">boolean</code></td><td class="svelte-1ebbyds">true</td><td class="svelte-1ebbyds">Honor X-RateLimit-* headers</td></tr><tr><td class="svelte-1ebbyds"><code class="svelte-1ebbyds">autoRetry</code></td><td class="svelte-1ebbyds"><code class="svelte-1ebbyds">boolean</code></td><td class="svelte-1ebbyds">false</td><td class="svelte-1ebbyds">Auto-retry failed requests</td></tr><tr><td class="svelte-1ebbyds"><code class="svelte-1ebbyds">maxRetries</code></td><td class="svelte-1ebbyds"><code class="svelte-1ebbyds">number</code></td><td class="svelte-1ebbyds">3</td><td class="svelte-1ebbyds">Max retry attempts</td></tr><tr><td class="svelte-1ebbyds"><code class="svelte-1ebbyds">retryDelay</code></td><td class="svelte-1ebbyds"><code class="svelte-1ebbyds">number</code></td><td class="svelte-1ebbyds">1000</td><td class="svelte-1ebbyds">Delay between retries (ms)</td></tr><tr><td class="svelte-1ebbyds"><code class="svelte-1ebbyds">retryStatusCodes</code></td><td class="svelte-1ebbyds"><code class="svelte-1ebbyds">number[]</code></td><td class="svelte-1ebbyds">[429, 500, 502, 503, 504]</td><td class="svelte-1ebbyds">Status codes to retry</td></tr></tbody></table></section></div>');function ep(e){const t=`import { RezoQueue } from 'rezo';

// Create a queue with concurrency limit
const queue = new RezoQueue({
  concurrency: 5,      // Max concurrent tasks
  interval: 1000,      // Min time between tasks (ms)
  intervalCap: 10      // Max tasks per interval
});

// Add tasks
queue.add(async () => {
  return await rezo.get('https://api.example.com/data/1');
});

queue.add(async () => {
  return await rezo.get('https://api.example.com/data/2');
});

// Wait for all to complete
await queue.onIdle();`,s=`import { HttpQueue } from 'rezo';

// HTTP-aware queue with per-domain limits
const queue = new HttpQueue({
  concurrency: 10,           // Global concurrency
  perDomainConcurrency: 2,   // Per-domain limit
  
  retry: {
    attempts: 3,
    delay: 1000,
    statusCodes: [429, 500, 502, 503]
  }
});

// Rate limit headers are automatically respected
queue.add(async () => {
  return await rezo.get('https://api.example.com/data');
});`,o=`import { RezoQueue, Priority } from 'rezo';

const queue = new RezoQueue({ concurrency: 3 });

// Add with priority
queue.add(lowPriorityTask, { priority: Priority.LOW });        // 25
queue.add(normalTask, { priority: Priority.NORMAL });          // 50
queue.add(highPriorityTask, { priority: Priority.HIGH });      // 75
queue.add(criticalTask, { priority: Priority.CRITICAL });      // 1000

// Higher priority tasks run first`,r=`const queue = new RezoQueue({ concurrency: 5 });

queue.on('add', (task) => {
  console.log('Task added, pending:', queue.pending);
});

queue.on('start', (task) => {
  console.log('Task started, active:', queue.active);
});

queue.on('completed', (result, task) => {
  console.log('Task completed:', result);
});

queue.on('error', (error, task) => {
  console.error('Task failed:', error);
});

queue.on('idle', () => {
  console.log('Queue is empty and idle');
});

queue.on('rateLimited', (domain) => {
  console.log('Rate limited for:', domain);
});`,a=`const queue = new RezoQueue({ concurrency: 5 });

// Pause processing
queue.pause();

// Add tasks while paused (they queue up)
queue.add(task1);
queue.add(task2);

// Resume processing
queue.resume();

// Clear pending tasks
queue.clear();

// Get statistics
console.log(queue.stats);
// { processed, completed, failed, timedOut, cancelled, averageDuration }`;var i=Yd();G("1ebbyds",k=>{U(()=>{F.title="Queue & Rate Limiting - Rezo Documentation"})});var c=n(p(i),4),l=n(p(c),2);f(l,{code:t,language:"typescript"});var d=n(c,2),u=n(p(d),2);f(u,{code:s,language:"typescript"});var v=n(d,2),h=n(p(v),2);f(h,{code:o,language:"typescript"});var g=n(v,2),y=n(p(g),2);f(y,{code:r,language:"typescript"});var x=n(g,2),b=n(p(x),2);f(b,{code:a,language:"typescript"}),E(e,i)}var tp=N('<article class="prose svelte-6osb76"><h1 class="svelte-6osb76">Caching</h1> <p class="lead svelte-6osb76">Rezo provides built-in response caching and DNS caching to improve performance and reduce redundant network requests.</p> <h2 class="svelte-6osb76">Response Cache</h2> <p class="svelte-6osb76">Enable response caching to store and reuse HTTP responses. Caching can be configured per-request or as a default option.</p> <h3 class="svelte-6osb76">Basic Usage</h3> <!> <h3 class="svelte-6osb76">Cache Options</h3> <table class="svelte-6osb76"><thead><tr><th class="svelte-6osb76">Option</th><th class="svelte-6osb76">Type</th><th class="svelte-6osb76">Description</th></tr></thead><tbody><tr><td class="svelte-6osb76"><code class="svelte-6osb76">cacheDir</code></td><td class="svelte-6osb76"><code class="svelte-6osb76">string</code></td><td class="svelte-6osb76">Directory for persistent cache storage</td></tr><tr><td class="svelte-6osb76"><code class="svelte-6osb76">ttl</code></td><td class="svelte-6osb76"><code class="svelte-6osb76">number</code></td><td class="svelte-6osb76">Time-to-live in milliseconds</td></tr><tr><td class="svelte-6osb76"><code class="svelte-6osb76">maxEntries</code></td><td class="svelte-6osb76"><code class="svelte-6osb76">number</code></td><td class="svelte-6osb76">Maximum number of entries to cache</td></tr><tr><td class="svelte-6osb76"><code class="svelte-6osb76">methods</code></td><td class="svelte-6osb76"><code class="svelte-6osb76">string[]</code></td><td class="svelte-6osb76">HTTP methods to cache (default: GET only)</td></tr><tr><td class="svelte-6osb76"><code class="svelte-6osb76">respectHeaders</code></td><td class="svelte-6osb76"><code class="svelte-6osb76">boolean</code></td><td class="svelte-6osb76">Honor Cache-Control headers from response</td></tr></tbody></table> <h3 class="svelte-6osb76">Custom Cache Configuration</h3> <!> <h2 class="svelte-6osb76">DNS Cache</h2> <p class="svelte-6osb76">DNS caching reduces DNS lookup overhead by caching resolved addresses.</p> <!> <h2 class="svelte-6osb76">Cache Hooks</h2> <p class="svelte-6osb76">Use the <code class="svelte-6osb76">beforeCache</code> hook to control caching behavior programmatically.</p> <!></article>');function sp(e){var t=tp();G("6osb76",i=>{U(()=>{F.title="Caching - Rezo Documentation"})});var s=n(p(t),10);f(s,{code:`import rezo from 'rezo';

// Enable memory-only cache
const response = await rezo.get('https://api.example.com/data', {
  cache: true
});

// With file persistence
const response2 = await rezo.get('https://api.example.com/data', {
  cache: {
    cacheDir: './cache',
    ttl: 300000 // 5 minutes
  }
});`,language:"typescript"});var o=n(s,8);f(o,{code:`const response = await rezo.get('https://api.example.com/data', {
  cache: {
    ttl: 600000,           // 10 minutes
    maxEntries: 1000,
    methods: ['GET'],      // Only cache GET requests
    respectHeaders: true   // Honor Cache-Control headers
  }
});`,language:"typescript"});var r=n(o,6);f(r,{code:`import rezo from 'rezo';

// Enable DNS caching
const response = await rezo.get('https://api.example.com/data', {
  dnsCache: true
});

// DNS cache with custom TTL
const response2 = await rezo.get('https://api.example.com/data', {
  dnsCache: {
    ttl: 60000 // 1 minute
  }
});`,language:"typescript"});var a=n(r,6);f(a,{code:`import { Rezo } from 'rezo';

const client = new Rezo({
  cache: true,
  hooks: {
    beforeCache: [(event) => {
      // Don't cache error responses
      if (event.status >= 400) {
        return false;
      }
      
      // Don't cache if no-store directive
      if (event.cacheControl?.noStore) {
        return false;
      }
      
      // Allow caching
      return true;
    }]
  }
});`,language:"typescript"}),E(e,t)}var op=N('<div class="space-y-12"><header><h1 class="text-3xl sm:text-4xl font-bold mb-4">TLS & Security</h1> <p class="text-lg" style="color: var(--muted);">Comprehensive TLS configuration, certificate management, and security best practices.</p></header> <section><h2 class="text-2xl font-bold mb-4">TLS Configuration</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Certificate Pinning</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Secure Defaults</h2> <!></section></div>');function rp(e){const t=`// Custom CA certificate
await rezo.get('https://internal-api.company.com', {
  ca: fs.readFileSync('./certs/internal-ca.pem')
});

// Client certificate authentication
await rezo.get('https://mtls-api.example.com', {
  cert: fs.readFileSync('./certs/client.pem'),
  key: fs.readFileSync('./certs/client-key.pem'),
  passphrase: 'key-password'  // If key is encrypted
});

// Skip certificate validation (not for production!)
await rezo.get('https://self-signed.example.com', {
  rejectUnauthorized: false
});`,s=`// Certificate pinning
await rezo.get('https://api.example.com', {
  checkServerIdentity: (host, cert) => {
    // Verify certificate fingerprint
    const fingerprint = cert.fingerprint256;
    const expected = 'AA:BB:CC:DD:EE:FF:...';
    
    if (fingerprint !== expected) {
      throw new Error('Certificate fingerprint mismatch');
    }
  }
});`,o=`// Rezo uses secure defaults
// - rejectUnauthorized: true (validates certificates)
// - TLS 1.2+ required
// - Secure cipher suites

// To customize TLS settings
await rezo.get('https://api.example.com', {
  secureOptions: require('constants').SSL_OP_NO_TLSv1,
  ciphers: 'ECDHE-RSA-AES128-GCM-SHA256:!aNULL:!MD5'
});`;var r=op();G("1o2ypmt",v=>{U(()=>{F.title="Security Best Practices - Rezo Documentation"})});var a=n(p(r),2),i=n(p(a),2);f(i,{code:t,language:"typescript"});var c=n(a,2),l=n(p(c),2);f(l,{code:s,language:"typescript"});var d=n(c,2),u=n(p(d),2);f(u,{code:o,language:"typescript"}),E(e,r)}var ap=N('<div class="space-y-12"><header><h1 class="text-3xl sm:text-4xl font-bold mb-4">Rezo Instance</h1> <p class="text-lg" style="color: var(--muted);">API reference for the Rezo instance and its methods.</p></header> <section><h2 class="text-2xl font-bold mb-4">Creating an Instance</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Instance Methods</h2> <!></section></div>');function np(e){const t=`import rezo from 'rezo';

// Create a new instance with custom defaults
const api = rezo.create({
  baseURL: 'https://api.example.com',
  timeout: 10000,
  headers: {
    'Authorization': 'Bearer token'
  }
});

// Instance methods
api.get(url, config?)
api.post(url, data?, config?)
api.put(url, data?, config?)
api.patch(url, data?, config?)
api.delete(url, config?)
api.head(url, config?)
api.options(url, config?)
api.request(config)`,s=`// Multipart helpers
api.postMultipart(url, data, config?)
api.putMultipart(url, data, config?)
api.patchMultipart(url, data, config?)

// Streaming helpers
api.getStream(url, config?)
api.download(url, filepath, config?)
api.upload(url, data, config?)

// Defaults
api.defaults  // Read/modify instance defaults`;var o=ap();G("1iz35bg",l=>{U(()=>{F.title="Rezo Instance API - Rezo Documentation"})});var r=n(p(o),2),a=n(p(r),2);f(a,{code:t,language:"typescript"});var i=n(r,2),c=n(p(i),2);f(c,{code:s,language:"typescript"}),E(e,o)}var ip=N('<div class="space-y-12"><header><h1 class="text-3xl sm:text-4xl font-bold mb-4">Request Options</h1> <p class="text-lg" style="color: var(--muted);">Complete reference for all request configuration options.</p></header> <section><h2 class="text-2xl font-bold mb-4">All Options</h2> <!></section></div>');function cp(e){const t=`interface RezoRequestConfig {
  // URL Configuration
  url?: string;
  baseURL?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  params?: Record<string, any>;

  // Request Body
  data?: any;

  // Headers
  headers?: Record<string, string>;

  // Timeouts
  timeout?: number | {
    connection?: number;
    request?: number;
    response?: number;
  };

  // Response
  responseType?: 'json' | 'text' | 'arraybuffer' | 'blob' | 'stream';
  validateStatus?: (status: number) => boolean;

  // Authentication
  auth?: {
    username: string;
    password: string;
    type?: 'basic' | 'digest' | 'ntlm';
  };

  // Cookies
  jar?: CookieJar;
  cookies?: Record<string, string>;
  withCredentials?: boolean;

  // Proxy
  proxy?: {
    host: string;
    port: number;
    protocol?: 'http' | 'https' | 'socks4' | 'socks5';
    auth?: { username: string; password: string };
  };
  proxyManager?: ProxyManager;
  useProxyManager?: boolean;

  // Retry
  retry?: {
    attempts?: number;
    delay?: number;
    multiplier?: number;
    statusCodes?: number[];
    methods?: string[];
    condition?: (error: RezoError) => boolean;
    respectRetryAfter?: boolean;
  };

  // Redirects
  maxRedirects?: number;
  followRedirects?: boolean;

  // TLS/SSL
  rejectUnauthorized?: boolean;
  ca?: string | Buffer;
  cert?: string | Buffer;
  key?: string | Buffer;
  passphrase?: string;

  // Cancellation
  signal?: AbortSignal;

  // Adapter
  adapter?: 'http' | 'http2' | 'fetch' | 'curl' | 'xhr' | 'react-native';

  // Progress
  onUploadProgress?: (progress: ProgressEvent) => void;
  onDownloadProgress?: (progress: ProgressEvent) => void;

  // Hooks
  hooks?: {
    init?: Function[];
    beforeRequest?: Function[];
    beforeRedirect?: Function[];
    beforeRetry?: Function[];
    afterResponse?: Function[];
    beforeError?: Function[];
  };
}`;var s=ip();G("n32z9t",a=>{U(()=>{F.title="Request Options API - Rezo Documentation"})});var o=n(p(s),2),r=n(p(o),2);f(r,{code:t,language:"typescript"}),E(e,s)}var lp=N('<div class="space-y-12"><header><h1 class="text-3xl sm:text-4xl font-bold mb-4">Response Object</h1> <p class="text-lg" style="color: var(--muted);">Structure of the response object returned by Rezo.</p></header> <section><h2 class="text-2xl font-bold mb-4">Response Type</h2> <!></section></div>');function dp(e){const t=`interface RezoResponse<T = any> {
  // Response data (auto-parsed)
  data: T;

  // HTTP status
  status: number;
  statusText: string;

  // Headers
  headers: RezoHeaders;

  // Cookies (merged request + response)
  cookies: {
    array: Cookie[];
    serialized: Record<string, string>;
    netscape: string;
    string: string;
    setCookiesString: string;
  };

  // Original request config
  config: RezoRequestConfig;

  // Underlying request object
  request: any;

  // Transfer metrics
  metrics?: {
    requestSize: number;
    responseSize: number;
    duration: number;
    contentLength: number;
  };
}`;var s=lp();G("1jk19q0",a=>{U(()=>{F.title="Response API - Rezo Documentation"})});var o=n(p(s),2),r=n(p(o),2);f(r,{code:t,language:"typescript"}),E(e,s)}var pp=N('<div class="space-y-12"><header><h1 class="text-3xl sm:text-4xl font-bold mb-4">RezoError</h1> <p class="text-lg" style="color: var(--muted);">Error class with enhanced details and type identification.</p></header> <section><h2 class="text-2xl font-bold mb-4">Error Type</h2> <!></section></div>');function up(e){const t=`class RezoError extends Error {
  // Error identification
  name: 'RezoError';
  code: RezoErrorCode;
  isRezoError: true;

  // HTTP details
  status?: number;
  statusText?: string;

  // Error type flags
  isHttpError: boolean;
  isNetworkError: boolean;
  isTimeout: boolean;
  isAborted: boolean;
  isProxyError: boolean;
  isSocksError: boolean;
  isTlsError: boolean;
  isRetryable: boolean;

  // Helpful information
  details: string;
  suggestion: string;

  // Request/Response
  config: RezoRequestConfig;
  request?: any;
  response?: RezoResponse;

  // Static method
  static isRezoError(error: any): error is RezoError;
}

enum RezoErrorCode {
  TIMEOUT = 'ETIMEDOUT',
  NETWORK_ERROR = 'ENETWORK',
  HTTP_ERROR = 'EHTTP',
  PROXY_ERROR = 'EPROXY',
  ABORT = 'EABORT',
  TLS_ERROR = 'ETLS',
  // ...
}`;var s=pp();G("1oplnfd",a=>{U(()=>{F.title="RezoError API - Rezo Documentation"})});var o=n(p(s),2),r=n(p(o),2);f(r,{code:t,language:"typescript"}),E(e,s)}var hp=N('<div class="space-y-12"><header><h1 class="text-3xl sm:text-4xl font-bold mb-4">Types</h1> <p class="text-lg" style="color: var(--muted);">TypeScript types and exports from Rezo.</p></header> <section><h2 class="text-2xl font-bold mb-4">Exports</h2> <!></section></div>');function mp(e){const t=`// Main exports
import rezo, {
  RezoError,
  RezoFormData,
  RezoCookieJar,
  RezoHeaders,
  RezoQueue,
  HttpQueue,
  ProxyManager,
  RezoPerformance
} from 'rezo';

// Type imports
import type {
  RezoRequestConfig,
  RezoResponse,
  RezoInstance,
  RezoAdapter,
  Cookie,
  Proxy,
  RetryConfig,
  HooksConfig,
  ProgressEvent,
  StreamResponse,
  DownloadResponse,
  UploadResponse
} from 'rezo';

// Error codes
import { RezoErrorCode } from 'rezo';

// Priority constants
import { Priority } from 'rezo';
// Priority.LOWEST (0)
// Priority.LOW (25)
// Priority.NORMAL (50)
// Priority.HIGH (75)
// Priority.HIGHEST (100)
// Priority.CRITICAL (1000)`;var s=hp();G("1j0645c",a=>{U(()=>{F.title="TypeScript Types - Rezo Documentation"})});var o=n(p(s),2),r=n(p(o),2);f(r,{code:t,language:"typescript"}),E(e,s)}var fp=N('<article class="prose svelte-1c64899"><h1 class="svelte-1c64899">RezoHeaders</h1> <p class="lead svelte-1c64899">RezoHeaders is an enhanced Headers class that provides convenient methods for working with HTTP headers, including content-type management, bearer token handling, and case-insensitive access.</p> <h2 class="svelte-1c64899">Import</h2> <!> <h2 class="svelte-1c64899">Creating Headers</h2> <!> <h2 class="svelte-1c64899">Common Methods</h2> <h3 class="svelte-1c64899">Content-Type Management</h3> <!> <h3 class="svelte-1c64899">Authorization</h3> <!> <h3 class="svelte-1c64899">Standard Methods</h3> <!> <h2 class="svelte-1c64899">Usage with Requests</h2> <!> <h2 class="svelte-1c64899">Method Reference</h2> <table class="svelte-1c64899"><thead><tr><th class="svelte-1c64899">Method</th><th class="svelte-1c64899">Description</th></tr></thead><tbody><tr><td class="svelte-1c64899"><code class="svelte-1c64899">set(name, value)</code></td><td class="svelte-1c64899">Set a header value</td></tr><tr><td class="svelte-1c64899"><code class="svelte-1c64899">get(name)</code></td><td class="svelte-1c64899">Get a header value (case-insensitive)</td></tr><tr><td class="svelte-1c64899"><code class="svelte-1c64899">has(name)</code></td><td class="svelte-1c64899">Check if header exists</td></tr><tr><td class="svelte-1c64899"><code class="svelte-1c64899">delete(name)</code></td><td class="svelte-1c64899">Remove a header</td></tr><tr><td class="svelte-1c64899"><code class="svelte-1c64899">setContentType(type)</code></td><td class="svelte-1c64899">Set Content-Type header</td></tr><tr><td class="svelte-1c64899"><code class="svelte-1c64899">getContentType()</code></td><td class="svelte-1c64899">Get Content-Type header</td></tr><tr><td class="svelte-1c64899"><code class="svelte-1c64899">setBearer(token)</code></td><td class="svelte-1c64899">Set Bearer authorization</td></tr><tr><td class="svelte-1c64899"><code class="svelte-1c64899">setBasicAuth(user, pass)</code></td><td class="svelte-1c64899">Set Basic authorization</td></tr><tr><td class="svelte-1c64899"><code class="svelte-1c64899">isJson()</code></td><td class="svelte-1c64899">Check if Content-Type is JSON</td></tr><tr><td class="svelte-1c64899"><code class="svelte-1c64899">isFormData()</code></td><td class="svelte-1c64899">Check if Content-Type is multipart</td></tr><tr><td class="svelte-1c64899"><code class="svelte-1c64899">isUrlEncoded()</code></td><td class="svelte-1c64899">Check if Content-Type is form-urlencoded</td></tr><tr><td class="svelte-1c64899"><code class="svelte-1c64899">toObject()</code></td><td class="svelte-1c64899">Convert to plain object</td></tr></tbody></table></article>');function vp(e){var t=fp();G("1c64899",l=>{U(()=>{F.title="RezoHeaders - Rezo Documentation"})});var s=n(p(t),6);f(s,{code:"import { RezoHeaders } from 'rezo';",language:"typescript"});var o=n(s,4);f(o,{code:`// From object
const headers = new RezoHeaders({
  'Content-Type': 'application/json',
  'Authorization': 'Bearer token123'
});

// From existing Headers
const headers2 = new RezoHeaders(existingHeaders);

// Empty headers
const headers3 = new RezoHeaders();`,language:"typescript"});var r=n(o,6);f(r,{code:`const headers = new RezoHeaders();

// Set content type
headers.setContentType('application/json');
headers.setContentType('application/x-www-form-urlencoded');
headers.setContentType('multipart/form-data');

// Get content type
const contentType = headers.getContentType();

// Check content type
if (headers.isJson()) { /* ... */ }
if (headers.isFormData()) { /* ... */ }
if (headers.isUrlEncoded()) { /* ... */ }`,language:"typescript"});var a=n(r,4);f(a,{code:`const headers = new RezoHeaders();

// Set bearer token
headers.setBearer('your-jwt-token');

// Set basic auth
headers.setBasicAuth('username', 'password');

// Get authorization header
const auth = headers.get('Authorization');`,language:"typescript"});var i=n(a,4);f(i,{code:`const headers = new RezoHeaders();

// Set header (case-insensitive key)
headers.set('X-Custom-Header', 'value');

// Get header
const value = headers.get('x-custom-header'); // Case-insensitive

// Check if header exists
if (headers.has('Content-Type')) { /* ... */ }

// Delete header
headers.delete('X-Custom-Header');

// Iterate headers
for (const [key, value] of headers) {
  console.log(\`\${key}: \${value}\`);
}

// Convert to plain object
const obj = headers.toObject();`,language:"typescript"});var c=n(i,4);f(c,{code:`import rezo, { RezoHeaders } from 'rezo';

const headers = new RezoHeaders();
headers.setBearer(accessToken);
headers.set('X-Request-ID', generateRequestId());

const response = await rezo.get('https://api.example.com/data', {
  headers
});`,language:"typescript"}),E(e,t)}var gp=N('<article class="prose svelte-1mw5dhh"><h1 class="svelte-1mw5dhh">RezoFormData</h1> <p class="lead svelte-1mw5dhh">RezoFormData is an enhanced FormData class for building multipart/form-data requests. It supports nested objects, file uploads, and automatic conversion from plain objects.</p> <h2 class="svelte-1mw5dhh">Import</h2> <!> <h2 class="svelte-1mw5dhh">Creating FormData</h2> <h3 class="svelte-1mw5dhh">From Object</h3> <p class="svelte-1mw5dhh">The <code class="svelte-1mw5dhh">fromObject</code> method handles nested objects and arrays automatically.</p> <!> <h3 class="svelte-1mw5dhh">Manual Construction</h3> <!> <h3 class="svelte-1mw5dhh">From Native FormData</h3> <!> <h2 class="svelte-1mw5dhh">File Uploads</h2> <!> <h2 class="svelte-1mw5dhh">Usage with Requests</h2> <h3 class="svelte-1mw5dhh">Using formData Option</h3> <!> <h3 class="svelte-1mw5dhh">Using postMultipart Helper</h3> <!> <h2 class="svelte-1mw5dhh">Method Reference</h2> <table class="svelte-1mw5dhh"><thead><tr><th class="svelte-1mw5dhh">Method</th><th class="svelte-1mw5dhh">Description</th></tr></thead><tbody><tr><td class="svelte-1mw5dhh"><code class="svelte-1mw5dhh">append(name, value, filename?)</code></td><td class="svelte-1mw5dhh">Append a field to the form data</td></tr><tr><td class="svelte-1mw5dhh"><code class="svelte-1mw5dhh">set(name, value, filename?)</code></td><td class="svelte-1mw5dhh">Set a field value (replaces existing)</td></tr><tr><td class="svelte-1mw5dhh"><code class="svelte-1mw5dhh">get(name)</code></td><td class="svelte-1mw5dhh">Get a field value</td></tr><tr><td class="svelte-1mw5dhh"><code class="svelte-1mw5dhh">getAll(name)</code></td><td class="svelte-1mw5dhh">Get all values for a field</td></tr><tr><td class="svelte-1mw5dhh"><code class="svelte-1mw5dhh">has(name)</code></td><td class="svelte-1mw5dhh">Check if field exists</td></tr><tr><td class="svelte-1mw5dhh"><code class="svelte-1mw5dhh">delete(name)</code></td><td class="svelte-1mw5dhh">Remove a field</td></tr><tr><td class="svelte-1mw5dhh"><code class="svelte-1mw5dhh">fromObject(obj)</code></td><td class="svelte-1mw5dhh">Static: Create from plain object</td></tr><tr><td class="svelte-1mw5dhh"><code class="svelte-1mw5dhh">fromNativeFormData(fd)</code></td><td class="svelte-1mw5dhh">Static: Create from native FormData</td></tr><tr><td class="svelte-1mw5dhh"><code class="svelte-1mw5dhh">getBoundary()</code></td><td class="svelte-1mw5dhh">Get multipart boundary string</td></tr><tr><td class="svelte-1mw5dhh"><code class="svelte-1mw5dhh">getHeaders()</code></td><td class="svelte-1mw5dhh">Get headers including Content-Type with boundary</td></tr></tbody></table></article>');function bp(e){var t=gp();G("1mw5dhh",d=>{U(()=>{F.title="RezoFormData - Rezo Documentation"})});var s=n(p(t),6);f(s,{code:"import { RezoFormData } from 'rezo';",language:"typescript"});var o=n(s,8);f(o,{code:`const formData = RezoFormData.fromObject({
  name: 'John Doe',
  email: 'john@example.com',
  profile: {
    age: 30,
    city: 'New York'
  },
  tags: ['developer', 'designer']
});

// Results in:
// name=John Doe
// email=john@example.com
// profile[age]=30
// profile[city]=New York
// tags[0]=developer
// tags[1]=designer`,language:"typescript"});var r=n(o,4);f(r,{code:`const formData = new RezoFormData();

formData.append('username', 'johndoe');
formData.append('avatar', fileBuffer, 'avatar.png');`,language:"typescript"});var a=n(r,4);f(a,{code:`const nativeFormData = new FormData();
nativeFormData.append('field', 'value');

const rezoFormData = await RezoFormData.fromNativeFormData(nativeFormData);`,language:"typescript"});var i=n(a,4);f(i,{code:`import { RezoFormData } from 'rezo';
import { readFileSync } from 'fs';

const formData = new RezoFormData();

// Append file with filename
formData.append('document', readFileSync('./report.pdf'), 'report.pdf');

// Append with content type
formData.append('image', imageBuffer, {
  filename: 'photo.jpg',
  contentType: 'image/jpeg'
});`,language:"typescript"});var c=n(i,6);f(c,{code:`import rezo, { RezoFormData } from 'rezo';

const formData = RezoFormData.fromObject({
  title: 'My Post',
  content: 'Post content here'
});

const response = await rezo.post('https://api.example.com/posts', {
  formData
});`,language:"typescript"});var l=n(c,4);f(l,{code:`import rezo from 'rezo';

// Automatically converts object to FormData
const response = await rezo.postMultipart('https://api.example.com/upload', {
  name: 'John',
  avatar: fileBuffer
});`,language:"typescript"}),E(e,t)}var yp=N(`<article class="prose svelte-bodga"><h1 class="svelte-bodga">RezoCookieJar</h1> <p class="lead svelte-bodga">RezoCookieJar provides RFC 6265 compliant cookie management with support for file persistence, multiple serialization formats, and domain-aware cookie handling.</p> <h2 class="svelte-bodga">Import</h2> <!> <h2 class="svelte-bodga">Basic Usage</h2> <p class="svelte-bodga">Rezo manages cookies automatically. Access the cookie jar via the <code class="svelte-bodga">cookieJar</code> property.</p> <!> <h2 class="svelte-bodga">Custom Cookie Jar</h2> <!> <h2 class="svelte-bodga">File Persistence</h2> <p class="svelte-bodga">Save and load cookies from files in JSON or Netscape format.</p> <!> <h3 class="svelte-bodga">Automatic Persistence</h3> <!> <h2 class="svelte-bodga">Manual Cookie Operations</h2> <h3 class="svelte-bodga">Setting Cookies</h3> <!> <h3 class="svelte-bodga">Getting Cookies</h3> <!> <h3 class="svelte-bodga">Removing Cookies</h3> <!> <h2 class="svelte-bodga">Serialization</h2> <!> <h2 class="svelte-bodga">Cookie Object Properties</h2> <table class="svelte-bodga"><thead><tr><th class="svelte-bodga">Property</th><th class="svelte-bodga">Type</th><th class="svelte-bodga">Description</th></tr></thead><tbody><tr><td class="svelte-bodga"><code class="svelte-bodga">key</code></td><td class="svelte-bodga"><code class="svelte-bodga">string</code></td><td class="svelte-bodga">Cookie name</td></tr><tr><td class="svelte-bodga"><code class="svelte-bodga">value</code></td><td class="svelte-bodga"><code class="svelte-bodga">string</code></td><td class="svelte-bodga">Cookie value</td></tr><tr><td class="svelte-bodga"><code class="svelte-bodga">domain</code></td><td class="svelte-bodga"><code class="svelte-bodga">string</code></td><td class="svelte-bodga">Domain the cookie belongs to</td></tr><tr><td class="svelte-bodga"><code class="svelte-bodga">path</code></td><td class="svelte-bodga"><code class="svelte-bodga">string</code></td><td class="svelte-bodga">URL path scope</td></tr><tr><td class="svelte-bodga"><code class="svelte-bodga">expires</code></td><td class="svelte-bodga"><code class="svelte-bodga">Date</code></td><td class="svelte-bodga">Expiration date</td></tr><tr><td class="svelte-bodga"><code class="svelte-bodga">httpOnly</code></td><td class="svelte-bodga"><code class="svelte-bodga">boolean</code></td><td class="svelte-bodga">HTTP only flag</td></tr><tr><td class="svelte-bodga"><code class="svelte-bodga">secure</code></td><td class="svelte-bodga"><code class="svelte-bodga">boolean</code></td><td class="svelte-bodga">Secure flag (HTTPS only)</td></tr><tr><td class="svelte-bodga"><code class="svelte-bodga">sameSite</code></td><td class="svelte-bodga"><code class="svelte-bodga">'strict' | 'lax' | 'none'</code></td><td class="svelte-bodga">SameSite attribute</td></tr></tbody></table> <h2 class="svelte-bodga">Method Reference</h2> <table class="svelte-bodga"><thead><tr><th class="svelte-bodga">Method</th><th class="svelte-bodga">Description</th></tr></thead><tbody><tr><td class="svelte-bodga"><code class="svelte-bodga">setCookieSync(cookie, url)</code></td><td class="svelte-bodga">Set a cookie for URL</td></tr><tr><td class="svelte-bodga"><code class="svelte-bodga">getCookiesSync(url)</code></td><td class="svelte-bodga">Get all cookies for URL</td></tr><tr><td class="svelte-bodga"><code class="svelte-bodga">getCookieStringSync(url)</code></td><td class="svelte-bodga">Get Cookie header string</td></tr><tr><td class="svelte-bodga"><code class="svelte-bodga">removeCookie(domain, path, key)</code></td><td class="svelte-bodga">Remove specific cookie</td></tr><tr><td class="svelte-bodga"><code class="svelte-bodga">removeCookies(domain)</code></td><td class="svelte-bodga">Remove all cookies for domain</td></tr><tr><td class="svelte-bodga"><code class="svelte-bodga">removeAllCookies()</code></td><td class="svelte-bodga">Clear all cookies</td></tr><tr><td class="svelte-bodga"><code class="svelte-bodga">saveToFile(path)</code></td><td class="svelte-bodga">Save to JSON or Netscape file</td></tr><tr><td class="svelte-bodga"><code class="svelte-bodga">loadFromFile(path)</code></td><td class="svelte-bodga">Static: Load from file</td></tr><tr><td class="svelte-bodga"><code class="svelte-bodga">serializeSync()</code></td><td class="svelte-bodga">Serialize to JSON string</td></tr><tr><td class="svelte-bodga"><code class="svelte-bodga">deserializeSync(str)</code></td><td class="svelte-bodga">Static: Deserialize from JSON</td></tr><tr><td class="svelte-bodga"><code class="svelte-bodga">toNetscapeString()</code></td><td class="svelte-bodga">Export as Netscape format</td></tr></tbody></table></article>`);function xp(e){var t=yp();G("bodga",v=>{U(()=>{F.title="RezoCookieJar - Rezo Documentation"})});var s=n(p(t),6);f(s,{code:"import { RezoCookieJar, Cookie } from 'rezo';",language:"typescript"});var o=n(s,6);f(o,{code:`import rezo from 'rezo';

// Make requests - cookies are handled automatically
await rezo.get('https://example.com/login');
await rezo.post('https://example.com/api/data', { body: { key: 'value' } });

// Access the cookie jar
const jar = rezo.cookieJar;

// Get all cookies for a domain
const cookies = jar.getCookiesSync('https://example.com');
console.log(cookies);`,language:"typescript"});var r=n(o,4);f(r,{code:`import { Rezo, RezoCookieJar } from 'rezo';

// Create custom cookie jar
const jar = new RezoCookieJar();

// Create client with custom jar
const client = new Rezo({ jar });

// Or assign later
client.cookieJar = new RezoCookieJar();`,language:"typescript"});var a=n(r,6);f(a,{code:`import { RezoCookieJar } from 'rezo';

const jar = new RezoCookieJar();

// Save to JSON file
jar.saveToFile('./cookies.json');

// Save to Netscape format (compatible with curl, wget)
jar.saveToFile('./cookies.txt');

// Load from file
const loadedJar = RezoCookieJar.loadFromFile('./cookies.json');`,language:"typescript"});var i=n(a,4);f(i,{code:`import { Rezo } from 'rezo';

// Cookies automatically saved after each request
const client = new Rezo({
  cookieFile: './cookies.json'
});`,language:"typescript"});var c=n(i,6);f(c,{code:`import { RezoCookieJar } from 'rezo';

const jar = new RezoCookieJar();

// Set cookie string
jar.setCookieSync(
  'session=abc123; Path=/; HttpOnly; Secure',
  'https://example.com'
);

// Set Cookie object
jar.setCookieSync({
  key: 'token',
  value: 'xyz789',
  domain: 'example.com',
  path: '/',
  httpOnly: true,
  secure: true,
  expires: new Date(Date.now() + 3600000)
}, 'https://example.com');`,language:"typescript"});var l=n(c,4);f(l,{code:`// Get all cookies for URL
const cookies = jar.getCookiesSync('https://example.com/api');

// Get cookie string for request header
const cookieString = jar.getCookieStringSync('https://example.com/api');
// Returns: "session=abc123; token=xyz789"

// Find specific cookie
const sessionCookie = cookies.find(c => c.key === 'session');`,language:"typescript"});var d=n(l,4);f(d,{code:`// Remove specific cookie
jar.removeCookie('example.com', '/', 'session');

// Remove all cookies for domain
jar.removeCookies('example.com');

// Clear all cookies
jar.removeAllCookies();`,language:"typescript"});var u=n(d,4);f(u,{code:`const jar = new RezoCookieJar();

// Serialize to JSON string
const jsonString = jar.serializeSync();

// Deserialize from JSON string
const restoredJar = RezoCookieJar.deserializeSync(jsonString);

// Get as Netscape format string
const netscapeString = jar.toNetscapeString();`,language:"typescript"}),E(e,t)}var wp=N('<article class="prose svelte-3207c3"><h1 class="svelte-3207c3">DOM Module</h1> <p class="lead svelte-3207c3">The DOM module provides server-side HTML parsing capabilities using <a href="https://github.com/WebReflection/linkedom" target="_blank" rel="noopener" class="svelte-3207c3">linkedom</a>. It enables DOM manipulation in Node.js environments without a browser.</p> <h2 class="svelte-3207c3">Import</h2> <!> <h2 class="svelte-3207c3">Parsing HTML</h2> <!> <h2 class="svelte-3207c3">Using with Rezo Requests</h2> <!> <h2 class="svelte-3207c3">DOMParser</h2> <!> <h2 class="svelte-3207c3">Available Exports</h2> <p class="svelte-3207c3">The DOM module re-exports the following from linkedom:</p> <table class="svelte-3207c3"><thead><tr><th class="svelte-3207c3">Export</th><th class="svelte-3207c3">Description</th></tr></thead><tbody><tr><td class="svelte-3207c3"><code class="svelte-3207c3">parseHTML</code></td><td class="svelte-3207c3">Parse HTML string and return document + window</td></tr><tr><td class="svelte-3207c3"><code class="svelte-3207c3">DOMParser</code></td><td class="svelte-3207c3">Standard DOMParser implementation</td></tr><tr><td class="svelte-3207c3"><code class="svelte-3207c3">Document</code></td><td class="svelte-3207c3">Document class</td></tr><tr><td class="svelte-3207c3"><code class="svelte-3207c3">Element</code></td><td class="svelte-3207c3">Element class</td></tr><tr><td class="svelte-3207c3"><code class="svelte-3207c3">HTMLElement</code></td><td class="svelte-3207c3">HTMLElement class</td></tr></tbody></table> <h2 class="svelte-3207c3">Common Patterns</h2> <h3 class="svelte-3207c3">Extracting Links</h3> <!> <h3 class="svelte-3207c3">Extracting Structured Data</h3> <!> <h3 class="svelte-3207c3">Form Data Extraction</h3> <!> <div class="tip svelte-3207c3"><strong>Tip:</strong> For web crawling use cases, consider using the <a href="/crawler" class="svelte-3207c3">Crawler</a> which provides built-in DOM parsing with event handlers for elements, links, and text content.</div></article>');function kp(e){var t=wp();G("3207c3",d=>{U(()=>{F.title="DOM Module - Rezo Documentation"})});var s=n(p(t),6);f(s,{code:"import { parseHTML, DOMParser } from 'rezo/dom';",language:"typescript"});var o=n(s,4);f(o,{code:`import { parseHTML } from 'rezo/dom';

const html = \`
<!DOCTYPE html>
<html>
  <head><title>Example</title></head>
  <body>
    <h1>Hello World</h1>
    <ul class="items">
      <li>Item 1</li>
      <li>Item 2</li>
      <li>Item 3</li>
    </ul>
  </body>
</html>
\`;

const { document, window } = parseHTML(html);

// Use standard DOM APIs
const title = document.querySelector('title')?.textContent;
console.log(title); // "Example"

const items = document.querySelectorAll('.items li');
items.forEach(item => console.log(item.textContent));`,language:"typescript"});var r=n(o,4);f(r,{code:`import rezo from 'rezo';
import { parseHTML } from 'rezo/dom';

const response = await rezo.get('https://example.com');
const { document } = parseHTML(response.data);

// Extract data from the page
const heading = document.querySelector('h1')?.textContent;
const links = document.querySelectorAll('a');

const hrefs = Array.from(links).map(link => ({
  text: link.textContent,
  href: link.getAttribute('href')
}));`,language:"typescript"});var a=n(r,4);f(a,{code:`import { DOMParser } from 'rezo/dom';

const parser = new DOMParser();
const doc = parser.parseFromString('<div>Hello</div>', 'text/html');

const div = doc.querySelector('div');
console.log(div?.textContent); // "Hello"`,language:"typescript"});var i=n(a,12);f(i,{code:`import { parseHTML } from 'rezo/dom';

function extractLinks(html: string, baseUrl: string): string[] {
  const { document } = parseHTML(html);
  const links = document.querySelectorAll('a[href]');
  
  return Array.from(links)
    .map(a => a.getAttribute('href'))
    .filter(Boolean)
    .map(href => new URL(href!, baseUrl).toString());
}`,language:"typescript"});var c=n(i,4);f(c,{code:`import { parseHTML } from 'rezo/dom';

interface Product {
  name: string;
  price: string;
  image: string;
}

function extractProducts(html: string): Product[] {
  const { document } = parseHTML(html);
  const productElements = document.querySelectorAll('.product');
  
  return Array.from(productElements).map(el => ({
    name: el.querySelector('.name')?.textContent || '',
    price: el.querySelector('.price')?.textContent || '',
    image: el.querySelector('img')?.getAttribute('src') || ''
  }));
}`,language:"typescript"});var l=n(c,4);f(l,{code:`import { parseHTML } from 'rezo/dom';

function extractFormData(html: string): Record<string, string> {
  const { document } = parseHTML(html);
  const form = document.querySelector('form');
  
  if (!form) return {};
  
  const data: Record<string, string> = {};
  const inputs = form.querySelectorAll('input[name]');
  
  inputs.forEach(input => {
    const name = input.getAttribute('name');
    const value = input.getAttribute('value') || '';
    if (name) data[name] = value;
  });
  
  return data;
}`,language:"typescript"}),E(e,t)}var Rp=N('<article class="prose svelte-6jsw1b"><h1 class="svelte-6jsw1b">Crawler</h1> <p class="lead svelte-6jsw1b">A powerful event-driven web crawler built on the Rezo HTTP client. Features automatic caching, proxy rotation, retry mechanisms, email lead discovery, and DOM parsing.</p> <h2 class="svelte-6jsw1b">Overview</h2> <p class="svelte-6jsw1b">The Crawler provides a fluent API for web scraping with chainable event handlers. It automatically handles caching, retries, and proxy rotation while you focus on data extraction.</p> <h2 class="svelte-6jsw1b">Import</h2> <!> <h2 class="svelte-6jsw1b">Quick Start</h2> <!> <h2 class="svelte-6jsw1b">Key Features</h2> <ul class="svelte-6jsw1b"><li class="svelte-6jsw1b"><strong>Event-Driven Parsing</strong> - Chain event handlers for documents, elements, links, and more</li> <li class="svelte-6jsw1b"><strong>Automatic Caching</strong> - Built-in file-based caching with configurable TTL</li> <li class="svelte-6jsw1b"><strong>Proxy Rotation</strong> - Domain-specific or global proxy configuration</li> <li class="svelte-6jsw1b"><strong>Rate Limiting</strong> - Domain-specific concurrency and interval controls</li> <li class="svelte-6jsw1b"><strong>Email Discovery</strong> - Automatic email lead extraction from pages</li> <li class="svelte-6jsw1b"><strong>Retry Logic</strong> - Configurable retry with proxy fallback</li></ul> <h2 class="svelte-6jsw1b">Basic Example: Scraping Products</h2> <!> <h2 class="svelte-6jsw1b">Event Handlers</h2> <p class="svelte-6jsw1b">The Crawler provides multiple event handlers for different parsing stages:</p> <table class="svelte-6jsw1b"><thead><tr><th class="svelte-6jsw1b">Event</th><th class="svelte-6jsw1b">Description</th></tr></thead><tbody><tr><td class="svelte-6jsw1b"><code class="svelte-6jsw1b">onDocument</code></td><td class="svelte-6jsw1b">Full document access</td></tr><tr><td class="svelte-6jsw1b"><code class="svelte-6jsw1b">onBody</code></td><td class="svelte-6jsw1b">Body element access</td></tr><tr><td class="svelte-6jsw1b"><code class="svelte-6jsw1b">onElement</code></td><td class="svelte-6jsw1b">All HTML elements</td></tr><tr><td class="svelte-6jsw1b"><code class="svelte-6jsw1b">onSelection</code></td><td class="svelte-6jsw1b">Elements matching CSS selector</td></tr><tr><td class="svelte-6jsw1b"><code class="svelte-6jsw1b">onAnchor</code></td><td class="svelte-6jsw1b">Anchor elements (links)</td></tr><tr><td class="svelte-6jsw1b"><code class="svelte-6jsw1b">onHref</code></td><td class="svelte-6jsw1b">Raw href strings</td></tr><tr><td class="svelte-6jsw1b"><code class="svelte-6jsw1b">onText</code></td><td class="svelte-6jsw1b">Text content from selector</td></tr><tr><td class="svelte-6jsw1b"><code class="svelte-6jsw1b">onAttribute</code></td><td class="svelte-6jsw1b">Attribute values from elements</td></tr><tr><td class="svelte-6jsw1b"><code class="svelte-6jsw1b">onResponse</code></td><td class="svelte-6jsw1b">HTTP response metadata</td></tr><tr><td class="svelte-6jsw1b"><code class="svelte-6jsw1b">onRawData</code></td><td class="svelte-6jsw1b">Raw response buffer</td></tr><tr><td class="svelte-6jsw1b"><code class="svelte-6jsw1b">onJson</code></td><td class="svelte-6jsw1b">JSON response data</td></tr><tr><td class="svelte-6jsw1b"><code class="svelte-6jsw1b">onError</code></td><td class="svelte-6jsw1b">Error handling</td></tr><tr><td class="svelte-6jsw1b"><code class="svelte-6jsw1b">onEmailDiscovered</code></td><td class="svelte-6jsw1b">Individual email found</td></tr><tr><td class="svelte-6jsw1b"><code class="svelte-6jsw1b">onEmailLeads</code></td><td class="svelte-6jsw1b">Batch of discovered emails</td></tr></tbody></table> <p class="svelte-6jsw1b">See the <a href="/crawler/events" class="svelte-6jsw1b">Event Handlers</a> page for detailed documentation of each event.</p> <h2 class="svelte-6jsw1b">Next Steps</h2> <ul class="svelte-6jsw1b"><li class="svelte-6jsw1b"><a href="/crawler/configuration" class="svelte-6jsw1b">Configuration Options</a></li> <li class="svelte-6jsw1b"><a href="/crawler/events" class="svelte-6jsw1b">Event Handlers</a></li> <li class="svelte-6jsw1b"><a href="/crawler/proxy" class="svelte-6jsw1b">Proxy Integration</a></li> <li class="svelte-6jsw1b"><a href="/crawler/caching" class="svelte-6jsw1b">Caching & Rate Limiting</a></li></ul></article>');function _p(e){var t=Rp();G("6jsw1b",a=>{U(()=>{F.title="Crawler - Rezo Documentation"})});var s=n(p(t),10);f(s,{code:`import { Crawler } from 'rezo/plugin';
import { Rezo } from 'rezo';`,language:"typescript"});var o=n(s,4);f(o,{code:`import { Crawler } from 'rezo/plugin';
import { Rezo } from 'rezo';

const http = new Rezo();

const crawler = new Crawler({
  baseUrl: 'https://example.com',
  enableCache: true,
  timeout: 30000
}, http);

crawler
  .onDocument(async (doc) => {
    console.log('Page title:', doc.title);
  })
  .onAnchor(async (anchor) => {
    console.log('Found link:', anchor.href);
  })
  .visit('/page1')
  .visit('/page2');

await crawler.waitForAll();`,language:"typescript"});var r=n(o,8);f(r,{code:`import { Crawler } from 'rezo/plugin';
import { Rezo } from 'rezo';

interface Product {
  name: string;
  price: string;
  url: string;
}

const products: Product[] = [];
const http = new Rezo();

const crawler = new Crawler({
  baseUrl: 'https://shop.example.com',
  enableCache: true,
  timeout: 15000
}, http);

crawler
  .onSelection<HTMLDivElement>('.product-card', async (card) => {
    products.push({
      name: card.querySelector('.name')?.textContent || '',
      price: card.querySelector('.price')?.textContent || '',
      url: card.querySelector('a')?.href || ''
    });
  })
  .onAnchor('.pagination a', async (link) => {
    // Follow pagination links
    crawler.visit(link.href);
  })
  .visit('/products');

await crawler.waitForAll();
console.log('Found products:', products.length);`,language:"typescript"}),E(e,t)}var Cp=N(`<article class="prose svelte-bck3id"><h1 class="svelte-bck3id">Crawler Configuration</h1> <p class="lead svelte-bck3id">Complete reference for all crawler configuration options including timeouts, retries, caching, and more.</p> <h2 class="svelte-bck3id">Constructor</h2> <!> <h2 class="svelte-bck3id">Basic Options</h2> <table class="svelte-bck3id"><thead><tr><th class="svelte-bck3id">Option</th><th class="svelte-bck3id">Type</th><th class="svelte-bck3id">Default</th><th class="svelte-bck3id">Description</th></tr></thead><tbody><tr><td class="svelte-bck3id"><code class="svelte-bck3id">baseUrl</code></td><td class="svelte-bck3id"><code class="svelte-bck3id">string</code></td><td class="svelte-bck3id">Required</td><td class="svelte-bck3id">Starting point for crawling operations</td></tr><tr><td class="svelte-bck3id"><code class="svelte-bck3id">timeout</code></td><td class="svelte-bck3id"><code class="svelte-bck3id">number</code></td><td class="svelte-bck3id">30000</td><td class="svelte-bck3id">Request timeout in milliseconds</td></tr><tr><td class="svelte-bck3id"><code class="svelte-bck3id">userAgent</code></td><td class="svelte-bck3id"><code class="svelte-bck3id">string</code></td><td class="svelte-bck3id">undefined</td><td class="svelte-bck3id">Custom user agent string</td></tr><tr><td class="svelte-bck3id"><code class="svelte-bck3id">useRndUserAgent</code></td><td class="svelte-bck3id"><code class="svelte-bck3id">boolean</code></td><td class="svelte-bck3id">false</td><td class="svelte-bck3id">Use random user agent per request</td></tr><tr><td class="svelte-bck3id"><code class="svelte-bck3id">maxRedirects</code></td><td class="svelte-bck3id"><code class="svelte-bck3id">number</code></td><td class="svelte-bck3id">10</td><td class="svelte-bck3id">Maximum redirects to follow</td></tr><tr><td class="svelte-bck3id"><code class="svelte-bck3id">rejectUnauthorized</code></td><td class="svelte-bck3id"><code class="svelte-bck3id">boolean</code></td><td class="svelte-bck3id">true</td><td class="svelte-bck3id">Reject unauthorized SSL certificates</td></tr><tr><td class="svelte-bck3id"><code class="svelte-bck3id">debug</code></td><td class="svelte-bck3id"><code class="svelte-bck3id">boolean</code></td><td class="svelte-bck3id">false</td><td class="svelte-bck3id">Enable debug logging</td></tr></tbody></table> <h2 class="svelte-bck3id">Retry Options</h2> <table class="svelte-bck3id"><thead><tr><th class="svelte-bck3id">Option</th><th class="svelte-bck3id">Type</th><th class="svelte-bck3id">Default</th><th class="svelte-bck3id">Description</th></tr></thead><tbody><tr><td class="svelte-bck3id"><code class="svelte-bck3id">maxRetryAttempts</code></td><td class="svelte-bck3id"><code class="svelte-bck3id">number</code></td><td class="svelte-bck3id">3</td><td class="svelte-bck3id">Maximum retry attempts for failed requests</td></tr><tr><td class="svelte-bck3id"><code class="svelte-bck3id">retryDelay</code></td><td class="svelte-bck3id"><code class="svelte-bck3id">number</code></td><td class="svelte-bck3id">0</td><td class="svelte-bck3id">Delay between retries in milliseconds</td></tr><tr><td class="svelte-bck3id"><code class="svelte-bck3id">retryOnStatusCode</code></td><td class="svelte-bck3id"><code class="svelte-bck3id">number[]</code></td><td class="svelte-bck3id">[408, 429, 500, 502, 503, 504]</td><td class="svelte-bck3id">Status codes that trigger retry</td></tr><tr><td class="svelte-bck3id"><code class="svelte-bck3id">retryOnProxyError</code></td><td class="svelte-bck3id"><code class="svelte-bck3id">boolean</code></td><td class="svelte-bck3id">true</td><td class="svelte-bck3id">Retry on proxy-related errors</td></tr><tr><td class="svelte-bck3id"><code class="svelte-bck3id">maxRetryOnProxyError</code></td><td class="svelte-bck3id"><code class="svelte-bck3id">number</code></td><td class="svelte-bck3id">3</td><td class="svelte-bck3id">Max retries for proxy errors</td></tr><tr><td class="svelte-bck3id"><code class="svelte-bck3id">retryWithoutProxyOnStatusCode</code></td><td class="svelte-bck3id"><code class="svelte-bck3id">number[]</code></td><td class="svelte-bck3id">[407, 403]</td><td class="svelte-bck3id">Status codes to retry without proxy</td></tr></tbody></table> <h2 class="svelte-bck3id">Cache Options</h2> <table class="svelte-bck3id"><thead><tr><th class="svelte-bck3id">Option</th><th class="svelte-bck3id">Type</th><th class="svelte-bck3id">Default</th><th class="svelte-bck3id">Description</th></tr></thead><tbody><tr><td class="svelte-bck3id"><code class="svelte-bck3id">enableCache</code></td><td class="svelte-bck3id"><code class="svelte-bck3id">boolean</code></td><td class="svelte-bck3id">true</td><td class="svelte-bck3id">Enable response caching</td></tr><tr><td class="svelte-bck3id"><code class="svelte-bck3id">cacheTTL</code></td><td class="svelte-bck3id"><code class="svelte-bck3id">number</code></td><td class="svelte-bck3id">604800000 (7 days)</td><td class="svelte-bck3id">Cache time-to-live in milliseconds</td></tr><tr><td class="svelte-bck3id"><code class="svelte-bck3id">cacheDir</code></td><td class="svelte-bck3id"><code class="svelte-bck3id">string</code></td><td class="svelte-bck3id">OS temp dir</td><td class="svelte-bck3id">Directory for cache storage</td></tr></tbody></table> <h2 class="svelte-bck3id">URL Handling Options</h2> <table class="svelte-bck3id"><thead><tr><th class="svelte-bck3id">Option</th><th class="svelte-bck3id">Type</th><th class="svelte-bck3id">Default</th><th class="svelte-bck3id">Description</th></tr></thead><tbody><tr><td class="svelte-bck3id"><code class="svelte-bck3id">forceRevisit</code></td><td class="svelte-bck3id"><code class="svelte-bck3id">boolean</code></td><td class="svelte-bck3id">false</td><td class="svelte-bck3id">Force revisiting URLs even if visited</td></tr><tr><td class="svelte-bck3id"><code class="svelte-bck3id">allowRevisiting</code></td><td class="svelte-bck3id"><code class="svelte-bck3id">boolean</code></td><td class="svelte-bck3id">false</td><td class="svelte-bck3id">Allow same URL to be visited multiple times</td></tr></tbody></table> <h2 class="svelte-bck3id">Error Handling</h2> <table class="svelte-bck3id"><thead><tr><th class="svelte-bck3id">Option</th><th class="svelte-bck3id">Type</th><th class="svelte-bck3id">Default</th><th class="svelte-bck3id">Description</th></tr></thead><tbody><tr><td class="svelte-bck3id"><code class="svelte-bck3id">throwFatalError</code></td><td class="svelte-bck3id"><code class="svelte-bck3id">boolean</code></td><td class="svelte-bck3id">false</td><td class="svelte-bck3id">Throw errors or handle gracefully</td></tr></tbody></table> <h2 class="svelte-bck3id">Complete Example</h2> <!> <h2 class="svelte-bck3id">Domain-Specific Configuration</h2> <p class="svelte-bck3id">The Crawler supports domain-specific configuration for proxies, rate limiting, and headers.
    See <a href="/crawler/proxy" class="svelte-bck3id">Proxy Integration</a> and <a href="/crawler/caching" class="svelte-bck3id">Rate Limiting</a> for details.</p></article>`);function Sp(e){var t=Cp();G("bck3id",r=>{U(()=>{F.title="Crawler Configuration - Rezo Documentation"})});var s=n(p(t),6);f(s,{code:`import { Crawler } from 'rezo/plugin';
import { Rezo } from 'rezo';

const http = new Rezo();

const crawler = new Crawler({
  baseUrl: 'https://example.com',
  // ... options
}, http);`,language:"typescript"});var o=n(s,24);f(o,{code:`import { Crawler } from 'rezo/plugin';
import { Rezo } from 'rezo';

const http = new Rezo();

const crawler = new Crawler({
  baseUrl: 'https://example.com',
  
  // Timeouts
  timeout: 15000,
  maxRedirects: 5,
  
  // User Agent
  useRndUserAgent: true,
  
  // Retry configuration
  maxRetryAttempts: 5,
  retryDelay: 1000,
  retryOnStatusCode: [429, 500, 502, 503, 504],
  retryOnProxyError: true,
  
  // Cache configuration  
  enableCache: true,
  cacheTTL: 1000 * 60 * 60 * 24, // 1 day
  cacheDir: './crawler-cache',
  
  // URL handling
  allowRevisiting: false,
  forceRevisit: false,
  
  // Error handling
  throwFatalError: false,
  debug: true,
  
  // SSL
  rejectUnauthorized: true
}, http);`,language:"typescript"}),E(e,t)}var Tp=N('<article class="prose svelte-12w43eq"><h1 class="svelte-12w43eq">Event Handlers</h1> <p class="lead svelte-12w43eq">The Crawler uses an event-driven architecture with chainable handlers for different parsing stages.</p> <h2 class="svelte-12w43eq">Document Events</h2> <h3 class="svelte-12w43eq">onDocument</h3> <p class="svelte-12w43eq">Access the full parsed Document object.</p> <!> <h3 class="svelte-12w43eq">onBody</h3> <p class="svelte-12w43eq">Access the document body element.</p> <!> <h2 class="svelte-12w43eq">Element Events</h2> <h3 class="svelte-12w43eq">onElement</h3> <p class="svelte-12w43eq">Called for every HTML element in the document.</p> <!> <h3 class="svelte-12w43eq">onSelection</h3> <p class="svelte-12w43eq">Select elements matching a CSS selector. Most commonly used for scraping.</p> <!> <h2 class="svelte-12w43eq">Link Events</h2> <h3 class="svelte-12w43eq">onAnchor</h3> <p class="svelte-12w43eq">Handle anchor elements. Can optionally filter by CSS selector.</p> <!> <h3 class="svelte-12w43eq">onHref</h3> <p class="svelte-12w43eq">Get raw href strings from all anchor elements.</p> <!> <h2 class="svelte-12w43eq">Text & Attribute Events</h2> <h3 class="svelte-12w43eq">onText</h3> <p class="svelte-12w43eq">Extract text content from elements matching a selector.</p> <!> <h3 class="svelte-12w43eq">onAttribute</h3> <p class="svelte-12w43eq">Extract attribute values from elements.</p> <!> <h2 class="svelte-12w43eq">Response Events</h2> <h3 class="svelte-12w43eq">onResponse</h3> <p class="svelte-12w43eq">Access HTTP response metadata.</p> <!> <h3 class="svelte-12w43eq">onRawData</h3> <p class="svelte-12w43eq">Access raw response buffer (for binary data).</p> <!> <h3 class="svelte-12w43eq">onJson</h3> <p class="svelte-12w43eq">Automatically parse JSON responses.</p> <!> <h2 class="svelte-12w43eq">Error Events</h2> <h3 class="svelte-12w43eq">onError</h3> <p class="svelte-12w43eq">Handle errors during crawling.</p> <!> <h2 class="svelte-12w43eq">Email Discovery Events</h2> <h3 class="svelte-12w43eq">onEmailDiscovered</h3> <p class="svelte-12w43eq">Called when an individual email address is found.</p> <!> <h3 class="svelte-12w43eq">onEmailLeads</h3> <p class="svelte-12w43eq">Called with batch of discovered emails after crawling completes.</p> <!> <h2 class="svelte-12w43eq">Chaining Handlers</h2> <p class="svelte-12w43eq">All event handlers return the Crawler instance for fluent chaining.</p> <!> <h2 class="svelte-12w43eq">Execution Control</h2> <h3 class="svelte-12w43eq">visit</h3> <p class="svelte-12w43eq">Queue a URL for crawling.</p> <!> <h3 class="svelte-12w43eq">waitForAll</h3> <p class="svelte-12w43eq">Wait for all queued visits to complete.</p> <!></article>');function Ap(e){var t=Tp();G("12w43eq",_=>{U(()=>{F.title="Crawler Event Handlers - Rezo Documentation"})});var s=n(p(t),10);f(s,{code:`crawler.onDocument(async (doc) => {
  console.log('Title:', doc.title);
  console.log('URL:', doc.URL);
  
  const meta = doc.querySelector('meta[name="description"]');
  console.log('Description:', meta?.getAttribute('content'));
});`,language:"typescript"});var o=n(s,6);f(o,{code:`crawler.onBody(async (body) => {
  const text = body.textContent;
  console.log('Body text length:', text?.length);
});`,language:"typescript"});var r=n(o,8);f(r,{code:`crawler.onElement(async (element) => {
  if (element.tagName === 'IMG') {
    console.log('Image src:', element.getAttribute('src'));
  }
});`,language:"typescript"});var a=n(r,6);f(a,{code:`// Type-safe element selection
crawler.onSelection<HTMLDivElement>('.product-card', async (card) => {
  const name = card.querySelector('.name')?.textContent;
  const price = card.querySelector('.price')?.textContent;
  const image = card.querySelector('img')?.src;
  
  products.push({ name, price, image });
});

// Multiple selectors
crawler.onSelection('.article', async (article) => {
  // Handle articles
});

crawler.onSelection('.sidebar-item', async (item) => {
  // Handle sidebar items
});`,language:"typescript"});var i=n(a,8);f(i,{code:`// All links
crawler.onAnchor(async (anchor) => {
  console.log('Link text:', anchor.textContent);
  console.log('Link href:', anchor.href);
});

// Filtered by selector
crawler.onAnchor('.nav-link', async (anchor) => {
  // Only navigation links
  crawler.visit(anchor.href);
});`,language:"typescript"});var c=n(i,6);f(c,{code:`crawler.onHref(async (href) => {
  if (href.includes('/products/')) {
    crawler.visit(href);
  }
});`,language:"typescript"});var l=n(c,8);f(l,{code:`crawler.onText('h1', async (text) => {
  console.log('Page heading:', text);
});

crawler.onText('.article-content p', async (text) => {
  paragraphs.push(text);
});`,language:"typescript"});var d=n(l,6);f(d,{code:`// Get all image sources
crawler.onAttribute('src', async (src) => {
  imageUrls.push(src);
});

// Get data attributes from specific elements
crawler.onAttribute('data-id', '.product-card', async (id) => {
  productIds.push(id);
});`,language:"typescript"});var u=n(d,8);f(u,{code:`crawler.onResponse(async (response) => {
  console.log('Status:', response.status);
  console.log('Content-Type:', response.contentType);
  console.log('Final URL:', response.finalUrl);
  console.log('Headers:', response.headers);
});`,language:"typescript"});var v=n(u,6);f(v,{code:`crawler.onRawData(async (buffer) => {
  // Save binary response
  fs.writeFileSync('output.bin', buffer);
});`,language:"typescript"});var h=n(v,6);f(h,{code:`interface ApiResponse {
  users: { id: number; name: string }[];
  total: number;
}

crawler.onJson<ApiResponse>(async (data) => {
  console.log('Total users:', data.total);
  for (const user of data.users) {
    console.log('User:', user.name);
  }
});`,language:"typescript"});var g=n(h,8);f(g,{code:`import { RezoError } from 'rezo';

crawler.onError<RezoError>(async (error) => {
  console.error('Crawl error:', error.message);
  console.error('URL:', error.url);
  console.error('Status:', error.status);
  
  // Log to file or monitoring service
  await logError(error);
});`,language:"typescript"});var y=n(g,8);f(y,{code:`crawler.onEmailDiscovered(async (event) => {
  console.log('Email found:', event.email);
  console.log('Source URL:', event.url);
  console.log('Context:', event.context);
});`,language:"typescript"});var x=n(y,6);f(x,{code:`crawler.onEmailLeads(async (emails) => {
  console.log('All emails found:', emails);
  await saveToDatabase(emails);
});`,language:"typescript"});var b=n(x,6);f(b,{code:`crawler
  .onDocument(async (doc) => { /* ... */ })
  .onSelection('.product', async (el) => { /* ... */ })
  .onAnchor('.pagination a', async (link) => { /* ... */ })
  .onError(async (err) => { /* ... */ })
  .visit('/products')
  .visit('/categories');

await crawler.waitForAll();`,language:"typescript"});var k=n(b,8);f(k,{code:`// Visit single URL
crawler.visit('/page');

// Visit with query parameters
crawler.visit('/search', { q: 'keyword', page: 1 });

// Chain visits
crawler
  .visit('/page1')
  .visit('/page2')
  .visit('/page3');`,language:"typescript"});var w=n(k,6);f(w,{code:`await crawler.waitForAll();
console.log('Crawling complete!');`,language:"typescript"}),E(e,t)}var Ep=N(`<article class="prose svelte-uoboxb"><h1 class="svelte-uoboxb">Proxy Integration</h1> <p class="lead svelte-uoboxb">Configure domain-specific or global proxy settings for crawler requests.</p> <h2 class="svelte-uoboxb">Basic Proxy Configuration</h2> <p class="svelte-uoboxb">Add proxies via the constructor or using the <code class="svelte-uoboxb">addProxy</code> method.</p> <!> <h2 class="svelte-uoboxb">Domain-Specific Proxies</h2> <p class="svelte-uoboxb">Use different proxies for different domains.</p> <!> <h2 class="svelte-uoboxb">Adding Proxies Dynamically</h2> <p class="svelte-uoboxb">Use the <code class="svelte-uoboxb">addProxy</code> method on the crawler config.</p> <!> <h2 class="svelte-uoboxb">Domain Pattern Matching</h2> <p class="svelte-uoboxb">Domain patterns support multiple formats:</p> <table class="svelte-uoboxb"><thead><tr><th class="svelte-uoboxb">Pattern</th><th class="svelte-uoboxb">Description</th></tr></thead><tbody><tr><td class="svelte-uoboxb"><code class="svelte-uoboxb">'example.com'</code></td><td class="svelte-uoboxb">Exact domain match</td></tr><tr><td class="svelte-uoboxb"><code class="svelte-uoboxb">'*.example.com'</code></td><td class="svelte-uoboxb">Wildcard subdomain match</td></tr><tr><td class="svelte-uoboxb"><code class="svelte-uoboxb">['a.com', 'b.com']</code></td><td class="svelte-uoboxb">Array of domains</td></tr><tr><td class="svelte-uoboxb"><code class="svelte-uoboxb">/^api\\./</code></td><td class="svelte-uoboxb">Regex pattern</td></tr><tr><td class="svelte-uoboxb"><code class="svelte-uoboxb">'*'</code></td><td class="svelte-uoboxb">Match all (with isGlobal: true)</td></tr></tbody></table> <h2 class="svelte-uoboxb">Proxy Authentication</h2> <!> <h2 class="svelte-uoboxb">SOCKS Proxy Support</h2> <!> <h2 class="svelte-uoboxb">Retry Without Proxy</h2> <p class="svelte-uoboxb">Configure automatic retry without proxy on certain status codes.</p> <!> <h2 class="svelte-uoboxb">Oxylabs Integration</h2> <p class="svelte-uoboxb">Built-in support for Oxylabs proxy service.</p> <!></article>`);function Ip(e){var t=Ep();G("uoboxb",d=>{U(()=>{F.title="Crawler Proxy Integration - Rezo Documentation"})});var s=n(p(t),8);f(s,{code:`import { Crawler } from 'rezo/plugin';
import { Rezo } from 'rezo';

const http = new Rezo();

const crawler = new Crawler({
  baseUrl: 'https://example.com',
  proxy: {
    enable: true,
    proxies: [{
      domain: '*',
      isGlobal: true,
      proxy: {
        protocol: 'http',
        host: 'proxy.example.com',
        port: 8080
      }
    }]
  }
}, http);`,language:"typescript"});var o=n(s,6);f(o,{code:`const crawler = new Crawler({
  baseUrl: 'https://example.com',
  proxy: {
    enable: true,
    proxies: [
      {
        domain: 'api.example.com',
        proxy: {
          protocol: 'http',
          host: 'api-proxy.example.com',
          port: 8080
        }
      },
      {
        domain: '*.data.example.com',
        proxy: {
          protocol: 'socks5',
          host: 'data-proxy.example.com',
          port: 1080
        }
      },
      {
        domain: '*',
        isGlobal: true,
        proxy: {
          protocol: 'http',
          host: 'default-proxy.example.com',
          port: 8080
        }
      }
    ]
  }
}, http);`,language:"typescript"});var r=n(o,6);f(r,{code:`crawler.config.addProxy({
  domain: 'secure.example.com',
  proxy: {
    protocol: 'socks5',
    host: '127.0.0.1',
    port: 9050,
    auth: {
      username: 'user',
      password: 'pass'
    }
  }
});`,language:"typescript"});var a=n(r,10);f(a,{code:`const crawler = new Crawler({
  baseUrl: 'https://example.com',
  proxy: {
    enable: true,
    proxies: [{
      domain: '*',
      isGlobal: true,
      proxy: {
        protocol: 'http',
        host: 'proxy.example.com',
        port: 8080,
        auth: {
          username: 'proxyuser',
          password: 'proxypass'
        }
      }
    }]
  }
}, http);`,language:"typescript"});var i=n(a,4);f(i,{code:`// SOCKS4
{
  protocol: 'socks4',
  host: '127.0.0.1',
  port: 1080
}

// SOCKS5 with authentication
{
  protocol: 'socks5',
  host: '127.0.0.1',
  port: 1080,
  auth: {
    username: 'user',
    password: 'pass'
  }
}`,language:"typescript"});var c=n(i,6);f(c,{code:`const crawler = new Crawler({
  baseUrl: 'https://example.com',
  
  // Retry without proxy on these status codes
  retryWithoutProxyOnStatusCode: [407, 403],
  
  // Enable retry on proxy errors
  retryOnProxyError: true,
  maxRetryOnProxyError: 3,
  
  proxy: {
    enable: true,
    proxies: [/* ... */]
  }
}, http);`,language:"typescript"});var l=n(c,6);f(l,{code:`const crawler = new Crawler({
  baseUrl: 'https://example.com',
  oxylabs: {
    enable: true,
    labs: [{
      domain: 'target-site.com',
      options: {
        username: 'your-username',
        password: 'your-password',
        country: 'us'
      },
      queueOptions: {
        concurrency: 5,
        interval: 1000
      }
    }]
  }
}, http);`,language:"typescript"}),E(e,t)}var zp=N('<article class="prose svelte-1f5s6pg"><h1 class="svelte-1f5s6pg">Caching & Rate Limiting</h1> <p class="lead svelte-1f5s6pg">Configure response caching and domain-specific rate limiting for efficient and polite crawling.</p> <h2 class="svelte-1f5s6pg">Response Caching</h2> <p class="svelte-1f5s6pg">The Crawler includes built-in file-based caching to avoid redundant requests.</p> <!> <h3 class="svelte-1f5s6pg">Cache Behavior</h3> <ul class="svelte-1f5s6pg"><li class="svelte-1f5s6pg">Cached responses are stored with encrypted namespace</li> <li class="svelte-1f5s6pg">Automatic cache expiration based on TTL</li> <li class="svelte-1f5s6pg">URL tracking prevents duplicate requests</li></ul> <h3 class="svelte-1f5s6pg">Bypassing Cache</h3> <p class="svelte-1f5s6pg">Use <code class="svelte-1f5s6pg">forceRevisit</code> to bypass cache for specific scenarios.</p> <!> <h2 class="svelte-1f5s6pg">Rate Limiting</h2> <p class="svelte-1f5s6pg">Configure domain-specific rate limiting to avoid overwhelming target servers.</p> <h3 class="svelte-1f5s6pg">Global Rate Limiting</h3> <!> <h3 class="svelte-1f5s6pg">Domain-Specific Rate Limiting</h3> <!> <h3 class="svelte-1f5s6pg">Adding Limiters Dynamically</h3> <!> <h2 class="svelte-1f5s6pg">Rate Limiter Options</h2> <table class="svelte-1f5s6pg"><thead><tr><th class="svelte-1f5s6pg">Option</th><th class="svelte-1f5s6pg">Type</th><th class="svelte-1f5s6pg">Description</th></tr></thead><tbody><tr><td class="svelte-1f5s6pg"><code class="svelte-1f5s6pg">concurrency</code></td><td class="svelte-1f5s6pg"><code class="svelte-1f5s6pg">number</code></td><td class="svelte-1f5s6pg">Maximum concurrent requests</td></tr><tr><td class="svelte-1f5s6pg"><code class="svelte-1f5s6pg">interval</code></td><td class="svelte-1f5s6pg"><code class="svelte-1f5s6pg">number</code></td><td class="svelte-1f5s6pg">Rate limit interval in milliseconds</td></tr><tr><td class="svelte-1f5s6pg"><code class="svelte-1f5s6pg">intervalCap</code></td><td class="svelte-1f5s6pg"><code class="svelte-1f5s6pg">number</code></td><td class="svelte-1f5s6pg">Maximum requests per interval</td></tr><tr><td class="svelte-1f5s6pg"><code class="svelte-1f5s6pg">timeout</code></td><td class="svelte-1f5s6pg"><code class="svelte-1f5s6pg">number</code></td><td class="svelte-1f5s6pg">Task timeout in milliseconds</td></tr></tbody></table> <h2 class="svelte-1f5s6pg">Custom Headers</h2> <p class="svelte-1f5s6pg">Configure domain-specific headers for crawling.</p> <!> <h2 class="svelte-1f5s6pg">URL Tracking</h2> <p class="svelte-1f5s6pg">The Crawler automatically tracks visited URLs to avoid duplicates.</p> <!> <h2 class="svelte-1f5s6pg">Complete Example</h2> <!></article>');function Pp(e){var t=zp();G("1f5s6pg",u=>{U(()=>{F.title="Crawler Caching & Rate Limiting - Rezo Documentation"})});var s=n(p(t),8);f(s,{code:`const crawler = new Crawler({
  baseUrl: 'https://example.com',
  
  // Enable caching (default: true)
  enableCache: true,
  
  // Cache TTL in milliseconds (default: 7 days)
  cacheTTL: 1000 * 60 * 60 * 24, // 1 day
  
  // Cache directory (default: OS temp dir)
  cacheDir: './crawler-cache'
}, http);`,language:"typescript"});var o=n(s,10);f(o,{code:`const crawler = new Crawler({
  baseUrl: 'https://example.com',
  enableCache: true,
  
  // Force re-fetch even if cached
  forceRevisit: true
}, http);`,language:"typescript"});var r=n(o,8);f(r,{code:`const crawler = new Crawler({
  baseUrl: 'https://example.com',
  limiter: {
    enable: true,
    limiters: [{
      domain: '*',
      isGlobal: true,
      options: {
        concurrency: 2,        // Max concurrent requests
        interval: 1000,        // Interval in ms
        intervalCap: 5         // Max requests per interval
      }
    }]
  }
}, http);`,language:"typescript"});var a=n(r,4);f(a,{code:`const crawler = new Crawler({
  baseUrl: 'https://example.com',
  limiter: {
    enable: true,
    limiters: [
      {
        domain: 'api.example.com',
        options: {
          concurrency: 5,
          interval: 100
        }
      },
      {
        domain: 'slow-server.example.com',
        options: {
          concurrency: 1,
          interval: 2000
        }
      },
      {
        domain: '*',
        isGlobal: true,
        options: {
          concurrency: 3,
          interval: 500
        }
      }
    ]
  }
}, http);`,language:"typescript"});var i=n(a,4);f(i,{code:`crawler.config.addLimiter({
  domain: 'new-domain.example.com',
  options: {
    concurrency: 2,
    interval: 1000,
    intervalCap: 10
  }
});`,language:"typescript"});var c=n(i,10);f(c,{code:`const crawler = new Crawler({
  baseUrl: 'https://example.com',
  headers: {
    enable: true,
    httpHeaders: [
      {
        domain: 'api.example.com',
        headers: {
          'Authorization': 'Bearer token123',
          'X-API-Key': 'my-api-key'
        }
      },
      {
        domain: '*',
        isGlobal: true,
        headers: {
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      }
    ]
  }
}, http);`,language:"typescript"});var l=n(c,6);f(l,{code:`const crawler = new Crawler({
  baseUrl: 'https://example.com',
  
  // Allow same URL to be visited multiple times
  allowRevisiting: false, // default
  
  // Force revisit even if URL was visited
  forceRevisit: false // default
}, http);`,language:"typescript"});var d=n(l,4);f(d,{code:`const crawler = new Crawler({
  baseUrl: 'https://example.com',
  
  // Caching
  enableCache: true,
  cacheTTL: 1000 * 60 * 60 * 24, // 1 day
  cacheDir: './cache',
  
  // Rate limiting
  limiter: {
    enable: true,
    limiters: [
      {
        domain: 'api.example.com',
        options: { concurrency: 5, interval: 200 }
      },
      {
        domain: '*',
        isGlobal: true,
        options: { concurrency: 2, interval: 1000 }
      }
    ]
  },
  
  // Custom headers
  headers: {
    enable: true,
    httpHeaders: [{
      domain: '*',
      isGlobal: true,
      headers: {
        'Accept': 'text/html',
        'Accept-Language': 'en-US'
      }
    }]
  }
}, http);

crawler
  .onSelection('.product', async (el) => {
    // Process products with automatic rate limiting
  })
  .visit('/products');

await crawler.waitForAll();`,language:"typescript"}),E(e,t)}var Np=N('<tr class="border-b" style="border-color: var(--border);"><td class="py-2 px-4 font-mono text-sm"> </td><td class="py-2 px-4 font-mono text-sm"> </td></tr>'),Mp=N('<div class="space-y-12"><header><h1 class="text-3xl sm:text-4xl font-bold mb-4">Migrating from Axios</h1> <p class="text-lg" style="color: var(--muted);">Rezo is designed as a drop-in replacement for Axios. Most code works unchanged.</p></header> <section><h2 class="text-2xl font-bold mb-4">Basic Requests</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Creating Instances</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Interceptors → Hooks</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Error Handling</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Key Differences</h2> <div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="border-b" style="border-color: var(--border);"><th class="text-left py-3 px-4">Axios</th><th class="text-left py-3 px-4">Rezo</th></tr></thead><tbody></tbody></table></div></section> <section><h2 class="text-2xl font-bold mb-4">What You Gain</h2> <div class="grid sm:grid-cols-2 gap-4"><div class="p-4 rounded-lg" style="background-color: var(--surface);"><h4 class="font-semibold mb-2 gradient-text">HTTP/2 Support</h4> <p class="text-sm" style="color: var(--muted);">Built-in HTTP/2 with session pooling</p></div> <div class="p-4 rounded-lg" style="background-color: var(--surface);"><h4 class="font-semibold mb-2 gradient-text">Cookie Jar</h4> <p class="text-sm" style="color: var(--muted);">Automatic cookie persistence</p></div> <div class="p-4 rounded-lg" style="background-color: var(--surface);"><h4 class="font-semibold mb-2 gradient-text">Proxy Rotation</h4> <p class="text-sm" style="color: var(--muted);">Built-in ProxyManager</p></div> <div class="p-4 rounded-lg" style="background-color: var(--surface);"><h4 class="font-semibold mb-2 gradient-text">Request Queue</h4> <p class="text-sm" style="color: var(--muted);">Priority-based queuing</p></div></div></section></div>');function Dp(e){const t=`// Axios
import axios from 'axios';
const response = await axios.get('/users');

// Rezo (identical API)
import rezo from 'rezo';
const response = await rezo.get('/users');`,s=`// Axios
const api = axios.create({
  baseURL: 'https://api.example.com',
  timeout: 10000
});

// Rezo (identical)
const api = rezo.create({
  baseURL: 'https://api.example.com',
  timeout: 10000
});`,o=`// Axios interceptors
axios.interceptors.request.use(config => {
  config.headers.Authorization = 'Bearer token';
  return config;
});

// Rezo hooks
const api = rezo.create({
  hooks: {
    beforeRequest: [(options) => {
      options.headers.Authorization = 'Bearer token';
      return options;
    }]
  }
});`,r=`// Axios (returns response for errors by default)
try {
  await axios.get('/users/999');
} catch (error) {
  if (axios.isAxiosError(error)) {
    console.log(error.response?.status);
  }
}

// Rezo (throws for 4xx/5xx by default)
try {
  await rezo.get('/users/999');
} catch (error) {
  if (RezoError.isRezoError(error)) {
    console.log(error.status);          // Direct access
    console.log(error.response?.data);  // Full response
    console.log(error.suggestion);      // Helpful hint
  }
}`,a=[{axios:"axios.isAxiosError()",rezo:"RezoError.isRezoError()"},{axios:"error.response.status",rezo:"error.status (direct)"},{axios:"interceptors.request.use()",rezo:"hooks.beforeRequest[]"},{axios:"interceptors.response.use()",rezo:"hooks.afterResponse[]"},{axios:"CancelToken (deprecated)",rezo:"AbortController (standard)"}];var i=Mp();G("hu9q75",_=>{U(()=>{F.title="Migrate from Axios - Rezo Documentation"})});var c=n(p(i),2),l=n(p(c),2);f(l,{code:t,language:"typescript"});var d=n(c,2),u=n(p(d),2);f(u,{code:s,language:"typescript"});var v=n(d,2),h=n(p(v),2);f(h,{code:o,language:"typescript"});var g=n(v,2),y=n(p(g),2);f(y,{code:r,language:"typescript"});var x=n(g,2),b=n(p(x),2),k=p(b),w=n(p(k));ze(w,5,()=>a,Ie,(_,S)=>{var P=Np(),I=p(P),T=p(I),A=n(I),O=p(A);pe(()=>{Q(T,C(S).axios),Q(O,C(S).rezo)}),E(_,P)}),E(e,i)}var Op=N('<div class="space-y-12"><header><h1 class="text-3xl sm:text-4xl font-bold mb-4">Migrating from Got</h1> <p class="text-lg" style="color: var(--muted);">Rezo shares many concepts with Got but works in browsers too.</p></header> <section><h2 class="text-2xl font-bold mb-4">Basic Requests</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Hooks</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Retry Configuration</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">What You Gain</h2> <div class="p-4 rounded-lg" style="background-color: var(--surface);"><ul class="space-y-2" style="color: var(--muted);"><li>✅ Browser support (Got is Node.js only)</li> <li>✅ React Native support</li> <li>✅ Edge runtime support</li> <li>✅ ProxyManager with rotation</li> <li>✅ Built-in request queuing</li></ul></div></section></div>');function Hp(e){const t=`// Got
import got from 'got';
const response = await got('https://api.example.com/users');
const data = JSON.parse(response.body);

// Rezo (auto-parses JSON)
import rezo from 'rezo';
const response = await rezo.get('https://api.example.com/users');
const data = response.data; // Already parsed`,s=`// Got hooks
const client = got.extend({
  hooks: {
    beforeRequest: [(options) => { ... }],
    afterResponse: [(response) => { ... }],
    beforeRetry: [(error, retryCount) => { ... }]
  }
});

// Rezo hooks (nearly identical)
const client = rezo.create({
  hooks: {
    beforeRequest: [(options) => { ... }],
    afterResponse: [(response) => { ... }],
    beforeRetry: [(options, error, retryCount) => { ... }]
  }
});`,o=`// Got retry
got('https://api.example.com', {
  retry: {
    limit: 3,
    methods: ['GET', 'POST'],
    statusCodes: [500, 502, 503]
  }
});

// Rezo retry
rezo.get('https://api.example.com', {
  retry: {
    attempts: 3,
    methods: ['GET', 'POST'],
    statusCodes: [500, 502, 503]
  }
});`;var r=Op();G("19tuc3x",v=>{U(()=>{F.title="Migrate from Got - Rezo Documentation"})});var a=n(p(r),2),i=n(p(a),2);f(i,{code:t,language:"typescript"});var c=n(a,2),l=n(p(c),2);f(l,{code:s,language:"typescript"});var d=n(c,2),u=n(p(d),2);f(u,{code:o,language:"typescript"}),E(e,r)}var Lp=N('<div class="space-y-12"><header><h1 class="text-3xl sm:text-4xl font-bold mb-4">Migrating from node-fetch</h1> <p class="text-lg" style="color: var(--muted);">Rezo provides a more ergonomic API with automatic error handling.</p></header> <section><h2 class="text-2xl font-bold mb-4">Basic Requests</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">POST Requests</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Error Handling</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">What You Gain</h2> <div class="p-4 rounded-lg" style="background-color: var(--surface);"><ul class="space-y-2" style="color: var(--muted);"><li>✅ Auto JSON parsing and serialization</li> <li>✅ Automatic error handling for 4xx/5xx</li> <li>✅ Cookie jar support</li> <li>✅ Proxy support (HTTP, HTTPS, SOCKS)</li> <li>✅ Retry logic with backoff</li> <li>✅ Request/response hooks</li></ul></div></section></div>');function qp(e){const t=`// node-fetch
import fetch from 'node-fetch';
const response = await fetch('https://api.example.com/users');
const data = await response.json();

// Rezo (simpler, auto-parses)
import rezo from 'rezo';
const response = await rezo.get('https://api.example.com/users');
const data = response.data;`,s=`// node-fetch
const response = await fetch('https://api.example.com/users', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'John' })
});

// Rezo (auto-serializes)
const response = await rezo.post('https://api.example.com/users', {
  name: 'John'
});`,o=`// node-fetch (must check status manually)
const response = await fetch('https://api.example.com/users/999');
if (!response.ok) {
  throw new Error(\`HTTP \${response.status}\`);
}

// Rezo (throws automatically for 4xx/5xx)
try {
  const response = await rezo.get('https://api.example.com/users/999');
} catch (error) {
  // Automatically thrown for 404
  console.log(error.status); // 404
}`;var r=Lp();G("wjucon",v=>{U(()=>{F.title="Migrate from node-fetch - Rezo Documentation"})});var a=n(p(r),2),i=n(p(a),2);f(i,{code:t,language:"typescript"});var c=n(a,2),l=n(p(c),2);f(l,{code:s,language:"typescript"});var d=n(c,2),u=n(p(d),2);f(u,{code:o,language:"typescript"}),E(e,r)}var Bp=N('<section><h2 class="text-2xl font-bold mb-2"> </h2> <p class="mb-4" style="color: var(--muted);"> </p> <!></section>'),jp=N('<div class="space-y-12"><header><h1 class="text-3xl sm:text-4xl font-bold mb-4">Examples</h1> <p class="text-lg" style="color: var(--muted);">Real-world examples and common patterns with Rezo.</p></header> <!></div>');function Up(e){const t=[{title:"REST API Client",description:"Create a typed API client with authentication",code:`import rezo from 'rezo';

interface User {
  id: number;
  name: string;
  email: string;
}

const api = rezo.create({
  baseURL: 'https://api.example.com/v1',
  headers: {
    'Authorization': 'Bearer ' + process.env.API_TOKEN
  }
});

// Typed requests
const users = await api.get<User[]>('/users');
const user = await api.post<User>('/users', { name: 'John', email: 'john@example.com' });`},{title:"File Upload with Progress",description:"Upload large files with progress tracking",code:`import rezo, { RezoFormData } from 'rezo';
import fs from 'fs';

const form = new RezoFormData();
form.append('file', fs.createReadStream('./video.mp4'));
form.append('title', 'My Video');

const upload = await rezo.upload('https://api.example.com/upload', form);

upload.on('progress', (p) => {
  console.log(\`Uploading: \${p.percent}% (\${p.speed} bytes/sec)\`);
});

upload.on('complete', (response) => {
  console.log('Upload complete:', response.data);
});`},{title:"Web Scraping with Cookies",description:"Maintain session across requests",code:`import rezo, { RezoCookieJar } from 'rezo';

const myJar = new RezoCookieJar();
const client = rezo.create({ jar: myJar });

// Login and store cookies
await client.post('https://example.com/login', {
  username: 'user',
  password: 'pass'
});

// Access protected page with cookies
const dashboard = await client.get('https://example.com/dashboard');
console.log(dashboard.data);

// Save cookies for later
fs.writeFileSync('cookies.json', JSON.stringify(myJar.toJSON()));`},{title:"Proxy Rotation",description:"Rotate proxies for web scraping",code:`import rezo, { ProxyManager } from 'rezo';

const manager = new ProxyManager({
  proxies: [
    { host: 'proxy1.example.com', port: 8080 },
    { host: 'proxy2.example.com', port: 8080 },
    { host: 'proxy3.example.com', port: 8080 }
  ],
  strategy: 'random',
  failureThreshold: 3
});

const api = rezo.create({ proxyManager: manager });

// Each request uses a different proxy
for (let i = 0; i < 100; i++) {
  const response = await api.get('https://target-site.com/page/' + i);
  console.log(response.data);
}`},{title:"Rate-Limited API Calls",description:"Queue requests with rate limiting",code:`import rezo, { HttpQueue } from 'rezo';

const queue = new HttpQueue({
  concurrency: 5,
  perDomainConcurrency: 2,
  interval: 1000,
  intervalCap: 10
});

const urls = Array.from({ length: 100 }, (_, i) => 
  'https://api.example.com/items/' + i
);

// Add all requests to queue
const results = await Promise.all(
  urls.map(url => queue.add(() => rezo.get(url)))
);

console.log('All requests completed:', results.length);`},{title:"Auto Token Refresh",description:"Automatically refresh expired tokens",code:`import rezo from 'rezo';

let accessToken = 'initial-token';
let refreshToken = 'refresh-token';

const api = rezo.create({
  baseURL: 'https://api.example.com',
  hooks: {
    beforeRequest: [(options) => {
      options.headers.Authorization = 'Bearer ' + accessToken;
      return options;
    }],
    beforeError: [async (error) => {
      if (error.status === 401) {
        // Refresh the token
        const response = await rezo.post('https://auth.example.com/refresh', {
          refreshToken
        });
        accessToken = response.data.accessToken;
        
        // Retry original request
        error.config.headers.Authorization = 'Bearer ' + accessToken;
        return await rezo.request(error.config);
      }
      throw error;
    }]
  }
});`}];var s=jp();G("jubuth",r=>{U(()=>{F.title="Examples - Rezo Documentation"})});var o=n(p(s),2);ze(o,1,()=>t,Ie,(r,a)=>{var i=Bp(),c=p(i),l=p(c),d=n(c,2),u=p(d),v=n(d,2);f(v,{get code(){return C(a).code},language:"typescript"}),pe(()=>{Q(l,C(a).title),Q(u,C(a).description)}),E(r,i)}),E(e,s)}var Fp=N('<div class="p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);"><h3 class="text-lg font-semibold mb-3"> </h3> <p style="color: var(--muted);"> </p></div>'),$p=N('<div class="space-y-12"><header><h1 class="text-3xl sm:text-4xl font-bold mb-4">FAQ</h1> <p class="text-lg" style="color: var(--muted);">Frequently asked questions about Rezo.</p></header> <section class="space-y-6"></section></div>');function Gp(e){const t=[{q:"How easy is it to switch to Rezo from other HTTP clients?",a:"Very easy. The API is designed to be intuitive and familiar. Interceptors become hooks, and error handling is explicit (Rezo throws for 4xx/5xx by default). Check our migration guides for details."},{q:"Does Rezo work in browsers?",a:"Yes! Use the Fetch adapter for modern browsers or XHR adapter for legacy support. The default import auto-selects the right adapter."},{q:"What Node.js version is required?",a:"Rezo requires Node.js 22+ for full feature support, including native zstd compression."},{q:"How do I handle cookies?",a:"Use RezoCookieJar for automatic cookie persistence. Pass it to requests with the `jar` option. Cookies are automatically merged between requests and responses."},{q:"Why do 4xx/5xx responses throw errors?",a:"This makes error handling explicit and integrates with retry logic. If you configure retry for specific status codes, Rezo retries first before throwing."},{q:"Can I use Rezo in Cloudflare Workers?",a:"Yes! Use the Fetch adapter which is compatible with edge runtimes. Note that features like cookie jars and proxies are limited in edge environments."},{q:"How does HTTP/2 work?",a:"Import from rezo/adapters/http2. Sessions are automatically pooled and reused for each origin. Multiple requests are multiplexed over a single connection."},{q:"Is there a size limit for uploads?",a:"No inherent limit. Use streaming for large files to avoid loading them into memory. The upload helper provides progress tracking."}];var s=$p();G("1vzfy22",r=>{U(()=>{F.title="FAQ - Rezo Documentation"})});var o=n(p(s),2);ze(o,5,()=>t,Ie,(r,a)=>{var i=Fp(),c=p(i),l=p(c),d=n(c,2),u=p(d);pe(()=>{Q(l,C(a).q),Q(u,C(a).a)}),E(r,i)}),E(e,s)}var Jp=N('<li class="flex items-start gap-2"><span class="text-green-500 mt-1">+</span> <span style="color: var(--muted);"> </span></li>'),Wp=N('<div class="p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);"><div class="flex items-center gap-3 mb-4"><span class="text-xl font-bold gradient-text"> </span> <span class="text-sm px-2 py-1 rounded" style="background-color: var(--border); color: var(--muted);"> </span></div> <ul class="space-y-2"></ul></div>'),Zp=N('<div class="space-y-12"><header><h1 class="text-3xl sm:text-4xl font-bold mb-4">Changelog</h1> <p class="text-lg" style="color: var(--muted);">Release history and version changes.</p></header> <section class="space-y-8"></section></div>');function Vp(e){const t=[{version:"1.0.0",date:"December 2024",changes:["Initial stable release","6 adapters: HTTP, HTTP/2, Fetch, cURL, XHR, React Native","Full cookie management with tough-cookie","Proxy support (HTTP, HTTPS, SOCKS4/5)","ProxyManager with rotation strategies","Request queue with priority and rate limiting","Lifecycle hooks system","Automatic retry with exponential backoff","Streaming downloads and uploads with progress","TypeScript first with full type definitions"]}];var s=Zp();G("nem33c",r=>{U(()=>{F.title="Changelog - Rezo Documentation"})});var o=n(p(s),2);ze(o,5,()=>t,Ie,(r,a)=>{var i=Wp(),c=p(i),l=p(c),d=p(l),u=n(l,2),v=p(u),h=n(c,2);ze(h,5,()=>C(a).changes,Ie,(g,y)=>{var x=Jp(),b=n(p(x),2),k=p(b);pe(()=>Q(k,C(y))),E(g,x)}),pe(()=>{Q(d,`v${C(a).version??""}`),Q(v,C(a).date)}),E(r,i)}),E(e,s)}var Kp=N(`<div class="space-y-12"><header><h1 class="text-3xl sm:text-4xl font-bold mb-4">Contributing</h1> <p class="text-lg" style="color: var(--muted);">Help improve Rezo! We welcome contributions of all kinds.</p></header> <section><h2 class="text-2xl font-bold mb-4">Ways to Contribute</h2> <div class="grid sm:grid-cols-2 gap-4"><div class="p-4 rounded-lg" style="background-color: var(--surface);"><h3 class="font-semibold mb-2">Report Bugs</h3> <p class="text-sm" style="color: var(--muted);">Found a bug? Open an issue on GitHub with steps to reproduce.</p></div> <div class="p-4 rounded-lg" style="background-color: var(--surface);"><h3 class="font-semibold mb-2">Request Features</h3> <p class="text-sm" style="color: var(--muted);">Have an idea? Open a feature request and describe your use case.</p></div> <div class="p-4 rounded-lg" style="background-color: var(--surface);"><h3 class="font-semibold mb-2">Improve Docs</h3> <p class="text-sm" style="color: var(--muted);">Fix typos, add examples, or improve explanations.</p></div> <div class="p-4 rounded-lg" style="background-color: var(--surface);"><h3 class="font-semibold mb-2">Submit PRs</h3> <p class="text-sm" style="color: var(--muted);">Fix bugs or implement new features with pull requests.</p></div></div></section> <section><h2 class="text-2xl font-bold mb-4">Development Setup</h2> <!></section> <section><h2 class="text-2xl font-bold mb-4">Report Issues</h2> <div class="p-6 rounded-xl border" style="background-color: var(--surface); border-color: var(--border);"><p class="mb-4" style="color: var(--muted);">Found a bug or have a feature request? Let us know!</p> <a href="https://github.com/user/rezo/issues/new" target="_blank" rel="noopener" class="gradient-bg text-white px-4 py-2 rounded-lg font-medium inline-block hover:opacity-90 transition-opacity">Open an Issue on GitHub</a></div></section> <section><h2 class="text-2xl font-bold mb-4">Code of Conduct</h2> <p style="color: var(--muted);">We are committed to providing a welcoming and inclusive environment. 
      Please read and follow our Code of Conduct when participating in this project.</p></section></div>`);function Xp(e){const t=`# Clone the repository
git clone https://github.com/user/rezo.git
cd rezo

# Install dependencies
bun install

# Run tests
bun test

# Build
bun run build`;var s=Kp();G("b42vvq",a=>{U(()=>{F.title="Contributing - Rezo Documentation"})});var o=n(p(s),4),r=n(p(o),2);f(r,{code:t,language:"bash"}),E(e,s)}var Qp=N('<div class="page-wrapper svelte-1n46o8q" style="background-color: var(--bg); color: var(--text);"><!> <!> <!></div>'),Yp=N('<div class="page-content svelte-1n46o8q"><!></div>'),eu=N('<div class="page-wrapper svelte-1n46o8q"><!></div>');function tu(e,t){he(t,!1);const s=()=>Fs(Ga,"$router",o),[o,r]=yo(),a=Ke(),i=Ke(),c=Ke(),l={"/":ra,"/docs":Lo,"/installation":pd,"/quick-start":hd,"/why-rezo":vd,"/requests":bd,"/responses":xd,"/configuration":kd,"/errors":_d,"/adapters":Ad,"/adapters/http":Id,"/adapters/http2":Pd,"/adapters/fetch":Md,"/adapters/curl":Od,"/adapters/xhr":Ld,"/adapters/react-native":Bd,"/advanced/cookies":Ud,"/advanced/proxy":$d,"/advanced/proxy-manager":Jd,"/advanced/streaming":Zd,"/advanced/retry":Kd,"/advanced/hooks":Qd,"/advanced/queue":ep,"/advanced/caching":sp,"/advanced/security":rp,"/api/instance":np,"/api/options":cp,"/api/response":dp,"/api/error":up,"/api/types":mp,"/utilities/headers":vp,"/utilities/formdata":bp,"/utilities/cookiejar":xp,"/utilities/dom":kp,"/crawler":_p,"/crawler/configuration":Sp,"/crawler/events":Ap,"/crawler/proxy":Ip,"/crawler/caching":Pp,"/migration/axios":Dp,"/migration/got":Hp,"/migration/node-fetch":qp,"/examples":Up,"/faq":Gp,"/changelog":Vp,"/contributing":Xp};qs(()=>s(),()=>{de(a,s())}),qs(()=>(C(a),Lo),()=>{de(i,l[C(a)]||Lo)}),qs(()=>C(a),()=>{de(c,C(a)==="/")}),mr();var d=Wo(),u=io(d);{var v=g=>{var y=Qp(),x=p(y);Ja(x,{isLanding:!0});var b=n(x,2);sn(b,{});var k=n(b,2);ra(k,{}),so(1,y,()=>Do,()=>({duration:300,easing:Oo})),E(g,y)},h=g=>{var y=eu(),x=p(y);Ml(x,{get currentPath(){return C(a)},children:(b,k)=>{var w=Wo(),_=io(w);tc(_,()=>C(a),S=>{var P=Yp(),I=p(P);ic(I,()=>C(i),(T,A)=>{A(T,{})}),so(1,P,()=>Hl,()=>({y:20,duration:400,delay:100,easing:Oo})),so(2,P,()=>Do,()=>({duration:150})),E(S,P)}),E(b,w)},$$slots:{default:!0}}),so(1,y,()=>Do,()=>({duration:300,easing:Oo})),E(g,y)};Ze(u,g=>{C(c)?g(v):g(h,!1)})}E(e,d),me(),r()}Qi(tu,{target:document.getElementById("app")});
