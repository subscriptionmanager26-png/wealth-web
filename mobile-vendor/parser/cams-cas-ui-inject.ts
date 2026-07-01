import type { CamsCasInjectInput } from "./cams-cas-types";

function fmtDdMonYyyy(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).formatToParts(d);
  const dd = parts.find((p) => p.type === "day")?.value ?? "01";
  const mon = parts.find((p) => p.type === "month")?.value ?? "Jan";
  const yyyy = parts.find((p) => p.type === "year")?.value ?? "2020";
  return `${dd}-${mon}-${yyyy}`;
}

/** Alternate flow: fill/submit CAMS page DOM directly (reCAPTCHA native to page context). */
export function buildCamsCasUiInjectScript(input: CamsCasInjectInput): string {
  const payload = {
    ...input,
    fromText: fmtDdMonYyyy(input.fromIso),
    toText: fmtDdMonYyyy(input.toIso),
  };
  const embedded = JSON.stringify(payload);
  return `(function () {
  function post(obj){ window.ReactNativeWebView.postMessage(JSON.stringify(obj)); }
  function progress(s){ post({ progress: s }); }
  function txt(el){ return (el && (el.textContent || el.innerText) || "").trim(); }
  function clickIf(el){ if(!el) return false; try{ el.click(); return true; }catch(e){ return false; } }
  function setVal(el, v){
    if(!el) return false;
    try{
      el.focus();
      var proto = Object.getPrototypeOf(el);
      var desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, v);
      else el.value = v;
      el.dispatchEvent(new Event('input', { bubbles:true }));
      el.dispatchEvent(new Event('change', { bubbles:true }));
      el.dispatchEvent(new Event('blur', { bubbles:true }));
      el.blur();
      return true;
    }catch(e){ return false; }
  }
  function findByLabel(rx){
    var labels = Array.prototype.slice.call(document.querySelectorAll('label, span, div, p, mat-label'));
    for(var i=0;i<labels.length;i++){
      var t = txt(labels[i]);
      if(rx.test(t)) return labels[i];
    }
    return null;
  }
  function clickRadioByText(rx){
    var nodes = Array.prototype.slice.call(document.querySelectorAll('mat-radio-button, mat-radio-button label, label, span, div'));
    for(var i=0;i<nodes.length;i++){
      var t = txt(nodes[i]);
      if(!rx.test(t)) continue;
      // Prefer clicking the material radio input if present.
      var host = nodes[i].closest ? (nodes[i].closest('mat-radio-button') || nodes[i]) : nodes[i];
      var inEl = host.querySelector && host.querySelector('input[type=radio]');
      if(clickIf(inEl)) return true;
      if(clickIf(host)) return true;
    }
    return false;
  }
  function clickByText(rx){
    var nodes = Array.prototype.slice.call(document.querySelectorAll('button, a, label, span, div'));
    for(var i=0;i<nodes.length;i++){
      if(rx.test(txt(nodes[i])) && clickIf(nodes[i])) return true;
    }
    return false;
  }
  function clickSelector(sel){
    var el = first(sel);
    return clickIf(el);
  }
  function isChecked(sel){
    var el = first(sel);
    return !!(el && el.checked);
  }
  function ensureRadioByValue(v){
    var sel = 'input[type=radio][value="' + v + '"]';
    var el = first(sel);
    if(!el) return false;
    if(el.checked) return true;
    return clickIf(el);
  }
  function ensureMaterialRadio(inputSel){
    var inEl = first(inputSel);
    if (!inEl) return false;
    if (clickIf(inEl)) return true;
    var host = inEl.closest ? (inEl.closest('mat-radio-button') || inEl.parentElement) : inEl.parentElement;
    return clickIf(host);
  }
  function setAllPasswordFields(v){
    var fields = Array.prototype.slice.call(document.querySelectorAll(
      'input[type=password], #password, #confirmPassword, input[formcontrolname*=password i], input[name*=password i], input[formcontrolname*=confirm i], input[name*=confirm i]'
    ));
    var seen = 0;
    for (var i=0;i<fields.length;i++) if (setVal(fields[i], v)) seen++;
    return seen;
  }
  function setDateField(selector, value){
    var el = first(selector);
    if(!el) return false;
    try{
      var ro = el.getAttribute('readonly');
      if (ro !== null) el.removeAttribute('readonly');
      var ok = setVal(el, value);
      if (ro !== null) el.setAttribute('readonly', ro === '' ? '' : ro);
      return ok;
    }catch(e){ return false; }
  }
  function readVal(selector){
    var el = first(selector);
    if(!el) return '';
    try { return String(el.value || '').trim(); } catch(e){ return ''; }
  }
  function fillCoreFields(INPUT){
    var detailedSet =
      ensureRadioByValue('detailed') ||
      ensureMaterialRadio('#mat-radio-3-input') ||
      ensureMaterialRadio('input[value="detailed"]') ||
      clickRadioByText(/^detailed$/i) ||
      clickRadioByText(/detailed/i);
    var specificSet =
      ensureRadioByValue('SP') ||
      ensureMaterialRadio('#mat-radio-15-input') ||
      ensureMaterialRadio('#mat-radio-10-input') ||
      ensureMaterialRadio('input[value="SP"], input[value="specific"]') ||
      clickRadioByText(/^specific\\s*period$/i) ||
      clickRadioByText(/specific\\s*period|specific/i);
    if (INPUT.zeroBalFolio === 'Y') clickRadioByText(/with\\s*zero\\s*balance/i);
    else clickRadioByText(/without\\s*zero\\s*balance|non\\s*zero|exclude\\s*zero/i);

    var emailDone =
      setVal(first('#mat-input-0, input#email, input[name="email_id"], input[formcontrolname="email"]'), INPUT.email) ||
      fillNearLabel(/email/i, INPUT.email) ||
      setVal(first('input[type=email]'), INPUT.email) ||
      setVal(first('input[formcontrolname*=email i], input[name*=email i]'), INPUT.email);

    var pwdFieldsDone = setAllPasswordFields(INPUT.password);
    if (INPUT.pan) {
      fillNearLabel(/pan/i, INPUT.pan) || setVal(first('input[formcontrolname*=pan i], input[name*=pan i]'), INPUT.pan);
    }

    // Date fields: strict selectors only (avoid broad "to"/"from" matching).
    fillNearLabel(/from\\s*date/i, INPUT.fromText);
    fillNearLabel(/to\\s*date|as\\s*on\\s*date/i, INPUT.toText);
    setDateField('input[placeholder*=from i], input[formcontrolname*=from i], input[id*=from i]', INPUT.fromText);
    setDateField('input[placeholder*=to i], input[placeholder*=todate i], input[formcontrolname*=to i], input[id*=to i]', INPUT.toText);
    // CAMS material id fallbacks seen in practice.
    setDateField('#mat-input-6', INPUT.fromText);
    setDateField('#mat-input-7', INPUT.toText);
    setDateField('#mat-input-4', INPUT.fromText);
    setDateField('#mat-input-5', INPUT.toText);
    // If there are two visible date-like text fields, set by order.
    try{
      var dateInputs = Array.prototype.filter.call(
        document.querySelectorAll('input.mat-input-element, input[type=text]'),
        function(el){
          var ph = (el.getAttribute('placeholder') || '').toLowerCase();
          var id = (el.id || '').toLowerCase();
          return /date|to|from/.test(ph) || /mat-input-\\d+/.test(id);
        }
      );
      if (dateInputs.length >= 2) {
        setVal(dateInputs[0], INPUT.fromText);
        setVal(dateInputs[1], INPUT.toText);
      }
    }catch(e){}

    return {
      detailedSet: detailedSet,
      specificSet: specificSet,
      emailDone: emailDone,
      pwdFieldsDone: pwdFieldsDone,
      fromVal: readVal('#mat-input-6') || readVal('input[placeholder*=from i], input[name*=from i], input[formcontrolname*=from i]'),
      toVal: readVal('#mat-input-7') || readVal('input[placeholder*=to i], input[name*=to i], input[placeholder*=todate i], input[formcontrolname*=to i]'),
    };
  }
  function fillNearLabel(rx, val){
    var l = findByLabel(rx);
    if(!l) return false;
    var root = l.closest ? (l.closest('mat-form-field, div, form, section') || l.parentElement || document) : document;
    var input = root.querySelector ? root.querySelector('input,textarea') : null;
    return setVal(input, val);
  }
  function first(sel){ return document.querySelector(sel); }
  function detectResult(){
    var body = txt(document.body).toLowerCase();
    if(/reference\\s*number|request\\s*(submitted|accepted)|success/.test(body)){
      return { ok:true, submit:{ mode:'ui', message:'Success text detected on CAMS page.' } };
    }
    if(/unable to process|invalid|error|failed|try again/.test(body)){
      return { ok:false, error:'CAMS page reported an error after submit.' };
    }
    return null;
  }
  function run(){
    try{
      var INPUT = ${embedded};
      progress('UI mode: starting form automation');

      // Disclaimer / proceed path if present.
      clickRadioByText(/accept/i);
      var proceed = Array.prototype.find.call(
        document.querySelectorAll('button, a, input[type=button], input[type=submit]'),
        function(el){ return /proceed|continue|next/i.test(txt(el)); }
      );
      clickIf(proceed);

      var state = fillCoreFields(INPUT);
      var tries = 0;
      var settle = setInterval(function(){
        tries++;
        state = fillCoreFields(INPUT);
        var ready =
          state.detailedSet &&
          state.specificSet &&
          state.emailDone &&
          state.pwdFieldsDone >= 2 &&
          state.fromVal &&
          state.toVal;
        if (ready || tries >= 12) {
          clearInterval(settle);
          progress('UI mode: settle pass done (tries=' + tries + ', pwd=' + state.pwdFieldsDone + ').');
        }
      }, 900);

      progress('UI mode: form values injected, waiting for native reCAPTCHA');

      setTimeout(function(){
        if (INPUT.autoSubmit === false) {
          progress('UI mode: form prefilled. Please review and tap Submit manually.');
          var endAt2 = Date.now() + 120000;
          var id2 = setInterval(function(){
            var r2 = detectResult();
            if (r2) { clearInterval(id2); post(r2); return; }
            if (Date.now() > endAt2) { clearInterval(id2); post({ ok:false, error:'UI mode: no submit result detected within 120s.' }); }
          }, 1200);
          return;
        }
        var submit = Array.prototype.find.call(
          document.querySelectorAll('button, input[type=submit], a'),
          function(el){ return /submit|check now|send|request/i.test(txt(el)); }
        );
        if(!submit){
          post({ ok:false, error:'UI mode: submit button not found.' });
          return;
        }
        clickIf(submit);
        progress('UI mode: submit clicked');

        var endAt = Date.now() + 45000;
        var id = setInterval(function(){
          var r = detectResult();
          if (r) { clearInterval(id); post(r); return; }
          if (Date.now() > endAt) { clearInterval(id); post({ ok:false, error:'UI mode: no success/error detected after submit.' }); }
        }, 1200);
      }, 2500);

      if(!state.detailedSet) progress('UI mode: warning - Detailed radio not matched.');
      if(!state.specificSet) progress('UI mode: warning - Specific Period radio not matched.');
      if(!state.emailDone || state.pwdFieldsDone < 2){
        progress('UI mode: warning - email/password fields may not have been fully matched.');
      }
    }catch(e){
      post({ ok:false, error:'UI mode script error: ' + String((e&&e.message)||e) });
    }
  }
  run();
})(); true;`;
}

