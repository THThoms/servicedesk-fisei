// =============================================================================
// scripts/testing/browser-ui-check.mjs — prueba en un NAVEGADOR REAL (Chrome
// headless vía DevTools Protocol) de lo que un HTTP 200 no demuestra:
//
//   images  <tokenFile> <path> <minImgs>
//      abre la SPA autenticada en <path> (p. ej. /mis-aceptados?openTicket=<id>),
//      espera a que las miniaturas se carguen por el endpoint autenticado y
//      comprueba que se DECODIFICAN (naturalWidth > 1); abre el lightbox y
//      comprueba la imagen ampliada.
//   accept  <tokenFile> <ticketNumber>
//      como solicitante: abre "Revisar y validar la solución", comprueba
//      términos + imágenes, que "Aceptar" está deshabilitado sin la casilla,
//      marca la casilla, acepta y lee el código de constancia mostrado.
//   blockprint <tokenFile> <código de constancia esperado> <prefijo de salida>
//      como admin: comprueba que /admin/bloques solo asigna técnicos; en la pantalla
//      Reportes (sin pestañas) elige el Bloque 1, genera el reporte, pulsa
//      "Imprimir", comprueba que NO se abre ninguna ventana, que print()
//      se llama UNA vez y las secciones obligatorias, y guarda <prefijo>.pdf y
//      <prefijo>-pantalla.png (la pantalla, tal como la ve el administrador).
//   techprint <tokenFile> <texto esperado> <prefijo de salida>
//      igual, con el reporte individual del técnico (TECH_NAME elige al técnico).
//   reject  <tokenFile> <ticketNumber> <motivo>
//      como solicitante: revisa, marca la casilla, comprueba que el motivo es
//      obligatorio, rechaza y lee el código de la constancia de rechazo.
//   historyprint <tokenFile> <id del ticket> <número del ticket>
//      imprime el historial del ticket: sin ventanas nuevas y con un solo print().
//
// Variables: CHROME (ruta), FRONTEND (origen de la SPA). Imprime una línea JSON.
// =============================================================================
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [mode, tokenFile, arg1, arg2] = process.argv.slice(2);
const REQUIRED_IN_PRINT = [
  "Universidad Técnica de Ambato", "Facultad de Ingeniería en Sistemas, Electrónica e Industrial", "Reporte general · Bloque 1",
  "Información del bloque", "Período consultado", "Fecha de generación", "Resumen general", "Total de técnicos del bloque", "Total de tickets atendidos", "Tickets cerrados",
  "Tickets pendientes de aceptación", "Tickets rechazados por el usuario", "Tickets que continúan en proceso",
  "Fecha de atención", "Usuario solicitante", "Descripción del trabajo", "Ubicación / laboratorio", "Laboratorio 1", "Solución utilizada", "Nota del técnico", "Historial relevante",
  "Validación digital del usuario", "ACEPTADO DIGITALMENTE", "Código único de aceptación", "Versión de los términos aceptados",
];
const REQUIRED_IN_TECH_PRINT = [
  "Universidad Técnica de Ambato", "Reporte individual del técnico", "Información del técnico", "Período del reporte", "Información de generación", "Resumen general",
  "Tickets asignados", "Estadísticas por servicio", "Estadísticas por estado", "Estadísticas por prioridad", "Historial completo de tickets", "Ubicación", "Laboratorio 1",
  "Solución utilizada", "Validación digital del usuario por ticket", "Actividad del técnico", "Reescalamientos", "Resoluciones", "Aportaciones",
];
const REPORT_PATH = process.env.REPORT_PATH ?? "/admin/reportes";
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const FRONTEND = process.env.FRONTEND ?? "http://127.0.0.1:23000";
const token = readFileSync(tokenFile, "utf8").trim();
const port = 9300 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), "sd-ui-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--window-size=1366,900",
  // Solo pruebas locales con certificado autofirmado (nginx de prueba).
  ...(process.env.ALLOW_SELF_SIGNED === "1" ? ["--ignore-certificate-errors"] : []),
  "about:blank",
], { stdio: "ignore" });

let ws;
const out = { mode, ok: false };
try {
  let targets = [];
  for (let i = 0; i < 60 && !targets.length; i++) {
    try { targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((t) => t.type === "page"); } catch {}
    if (!targets.length) await sleep(250);
  }
  ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const waitFor = async (expr, timeoutMs = 30000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) { const v = await evalJs(expr); if (v) return v; await sleep(300); }
    return null;
  };
  await send("Page.enable");
  await send("Page.navigate", { url: `${FRONTEND}/login` });
  await waitFor("document.readyState === 'complete'");
  await evalJs(`localStorage.setItem("sd_token", ${JSON.stringify(token)}); true`);

  const imgsState = (selector) => `(() => { const imgs = [...document.querySelectorAll(${JSON.stringify(selector)})];
    return imgs.map(i => ({ blob: i.src.startsWith("blob:"), complete: i.complete, w: i.naturalWidth, h: i.naturalHeight })); })()`;

  // Marco de impresión real: solo se intercepta print() (en headless no hay diálogo).
  const INTERCEPT_PRINT = `window.__printed = null; window.__printCalls = 0; window.__openCalls = 0;
      (() => { const realOpen = window.open.bind(window);
        window.open = (...a) => { window.__openCalls++; return realOpen(...a); };
        const realAppend = Node.prototype.appendChild;
        Node.prototype.appendChild = function (c) { const r = realAppend.call(this, c);
          if (c.tagName === "IFRAME" && c.id === "sd-print-frame") { const w = c.contentWindow;
            w.print = () => { window.__printCalls++; window.__printed = "<!DOCTYPE html>" + w.document.documentElement.outerHTML; }; }
          return r; }; })(); true`;

  if (mode === "images") {
    const [path, min] = [arg1, Number(arg2 ?? 1)];
    await send("Page.navigate", { url: `${FRONTEND}${path}` });
    const imgs = await waitFor(`(() => { const s = ${imgsState('img[alt="Adjunto del ticket"]')}; return s.length >= ${min} && s.every(x => x.complete && x.w > 0) ? s : null; })()`, 40000);
    out.thumbnails = imgs ?? (await evalJs(imgsState('img[alt="Adjunto del ticket"]')));
    out.errors = await evalJs(`[...document.querySelectorAll('[role="status"]')].map(e => e.textContent).filter(t => /No se pudo cargar/.test(t))`);
    await evalJs(`document.querySelector('button[title="Click para ampliar"], button[title="Ampliar"]')?.click(); true`);
    out.lightbox = await waitFor(`(() => { const i = document.querySelector('img[alt="Adjunto ampliado"]'); return i && i.complete && i.naturalWidth > 0 ? { w: i.naturalWidth, h: i.naturalHeight, blob: i.src.startsWith("blob:") } : null; })()`, 20000);
    out.ok = !!imgs && imgs.every((x) => x.blob && x.w > 1 && x.h > 1) && !!out.lightbox && out.lightbox.w > 1 && out.errors.length === 0;
  } else if (mode === "accept") {
    const number = arg1;
    await send("Page.navigate", { url: `${FRONTEND}/mis-tickets` });
    const found = await waitFor(`(() => { const card = [...document.querySelectorAll('div')].find(d => d.textContent.includes(${JSON.stringify(number)}) && d.querySelector('[data-testid="review-solution"]'));
      const b = card?.querySelector('[data-testid="review-solution"]'); if (b) { b.click(); return true; } return null; })()`, 30000);
    out.reviewOpened = !!found;
    out.terms = await waitFor(`document.querySelector('[data-testid="acceptance-terms"]')?.textContent?.slice(0, 60) || null`, 20000);
    out.modalImages = await waitFor(`(() => { const s = ${imgsState('[role="dialog"] img[alt="Adjunto del ticket"]')}; return s.length && s.every(x => x.complete && x.w > 1) ? s : null; })()`, 30000);
    out.acceptDisabledWithoutCheckbox = await evalJs(`document.querySelector('[data-testid="acceptance-accept"]')?.disabled === true`);
    await evalJs(`document.querySelector('[data-testid="acceptance-checkbox"]').click(); true`);
    out.acceptEnabledWithCheckbox = await waitFor(`document.querySelector('[data-testid="acceptance-accept"]')?.disabled === false`, 5000);
    await evalJs(`document.querySelector('[data-testid="acceptance-accept"]').click(); true`);
    out.flash = await waitFor(`(() => { const m = document.body.innerText.match(/Constancia de aceptación digital (VD-\\d{8}-[0-9A-F]{8})/); return m ? m[1] : null; })()`, 20000);
    out.ok = out.reviewOpened && !!out.terms && !!out.modalImages && out.acceptDisabledWithoutCheckbox === true && !!out.acceptEnabledWithCheckbox && !!out.flash;
  } else if (mode === "blockprint" || mode === "techprint") {
    const [needle, prefix] = [arg1, arg2];
    const block = mode === "blockprint";
    if (block) {
      // "Bloques" solo asigna técnicos: selectores de asignación y ningún reporte.
      await send("Page.navigate", { url: `${FRONTEND}/admin/bloques` });
      out.assignSelects = (await waitFor(`document.querySelectorAll('select[aria-label^="Bloque de"]').length || null`, 20000)) ?? 0;
      out.assignOnly = out.assignSelects > 0 && (await evalJs(`!/Imprimir|Generar reporte|DTIC \\(/.test(document.body.innerText)`));
      const shot = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(`${prefix}-asignacion.png`, Buffer.from(shot.result.data, "base64"));
    }
    // Una sola pantalla de Reportes, sin pestañas: el formulario decide el tipo de reporte.
    await send("Page.navigate", { url: `${FRONTEND}${REPORT_PATH}` });
    await waitFor(`document.querySelectorAll('#tech-select option').length > 1 && !!document.querySelector('#block-select')`);
    out.singleScreen = await evalJs(`!document.querySelector('[role="tablist"]')`);
    // Marco de impresión REAL: solo se intercepta print() (en headless no hay diálogo)
    // para comprobar que se llama, cuántas veces y con qué documento.
    await evalJs(INTERCEPT_PRINT);
    const choose = (sel, pick) => evalJs(`(() => { const s = document.querySelector(${JSON.stringify(sel)});
      const o = [...s.options].find(${pick}) ?? s.options[1];
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, o.value);
      s.dispatchEvent(new Event("change", { bubbles: true })); return o.textContent; })()`);
    if (block) {
      out.blockOption = await choose("#block-select", `(x) => x.value === "BLOQUE_1"`);
      out.blockFilters = !!(await waitFor(`!!document.querySelector('#status-select') && !!document.querySelector('#service-select')`, 5000));
    } else {
      await choose("#tech-select", `(x) => x.textContent.includes(${JSON.stringify(process.env.TECH_NAME ?? "")})`);
    }
    await sleep(300);
    out.kind = await evalJs(`document.querySelector('[data-testid="report-kind"]')?.textContent`);
    await evalJs(`document.querySelector('[data-testid="report-generate"]').click(); true`);
    out.reportShown = !!(await waitFor(block ? `!!document.querySelector('[data-testid="block-report"]')` : `!!document.querySelector('#report-body')`, 30000));
    await sleep(800);
    // Captura de la pantalla, tal como la ve el administrador.
    const metrics = await send("Page.getLayoutMetrics");
    const size = metrics.result.cssContentSize;
    const screen = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: size.width, height: Math.min(size.height, 4000), scale: 1 } });
    writeFileSync(`${prefix}-pantalla.png`, Buffer.from(screen.result.data, "base64"));
    // El clic lleva gesto de usuario, igual que una pulsación real (el bloqueador de ventanas lo exige).
    await send("Runtime.evaluate", { expression: `[...document.querySelectorAll("button")].find((b) => /Imprimir/.test(b.textContent))?.click(); true`, userGesture: true, returnByValue: true });
    const html = await waitFor(`window.__printed`, 10000);
    await sleep(1000); // margen para detectar una segunda impresión por el temporizador de respaldo
    // Ninguna ventana nueva: ni window.open ni otra pestaña en el navegador.
    out.openCalls = await evalJs(`window.__openCalls`);
    out.pages = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((x) => x.type === "page").length;
    out.printCalls = await evalJs(`window.__printCalls`);
    out.printHtmlBytes = html?.length ?? 0;
    out.missing = (block ? REQUIRED_IN_PRINT : REQUIRED_IN_TECH_PRINT).filter((s) => !(html ?? "").includes(s));
    out.hasNeedle = !!html?.includes(needle);
    out.hasInternalGuid = /\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/i.test(html ?? "");
    out.hasReplacementChar = !!html?.includes("�");
    const frameId = (await send("Page.getFrameTree")).result.frameTree.frame.id;
    await send("Page.setDocumentContent", { frameId, html: html ?? "" });
    await sleep(1500);
    // Sin logotipos oficiales no debe quedar ningún icono de imagen rota.
    out.brokenImages = await evalJs(`[...document.images].filter((i) => i.complete && i.naturalWidth === 0).length`);
    const pdf = await send("Page.printToPDF", { printBackground: true, preferCSSPageSize: true });
    writeFileSync(`${prefix}.pdf`, Buffer.from(pdf.result.data, "base64"));
    out.pdfBytes = Buffer.from(pdf.result.data, "base64").length;
    out.ok = out.singleScreen === true && (!block || (out.assignOnly === true && out.blockFilters === true)) && out.reportShown && out.openCalls === 0 && out.pages === 1 && out.printCalls === 1 && out.missing.length === 0 && out.hasNeedle && !out.hasInternalGuid && !out.hasReplacementChar && out.brokenImages === 0 && out.pdfBytes > 5000;
  } else if (mode === "reject") {
    const [number, reason] = [arg1, arg2];
    await send("Page.navigate", { url: `${FRONTEND}/mis-tickets` });
    const found = await waitFor(`(() => { const card = [...document.querySelectorAll('div')].find(d => d.textContent.includes(${JSON.stringify(number)}) && d.querySelector('[data-testid="review-solution"]'));
      const b = card?.querySelector('[data-testid="review-solution"]'); if (b) { b.click(); return true; } return null; })()`, 30000);
    out.reviewOpened = !!found;
    await waitFor(`!!document.querySelector('[data-testid="acceptance-terms"]')`, 20000);
    const buttonNamed = (name) => `[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.includes(${JSON.stringify(name)}))`;
    await evalJs(`document.querySelector('[data-testid="acceptance-checkbox"]').click(); true`);
    await evalJs(`${buttonNamed("Rechazar solución")}.click(); true`);
    await waitFor(`!!document.querySelector('#sa-reason')`, 5000);
    // Sin motivo no se registra nada: el formulario lo exige y el diálogo sigue abierto.
    await evalJs(`${buttonNamed("Confirmar rechazo")}.click(); true`);
    out.reasonRequired = !!(await waitFor(`/motivo del rechazo \\(mínimo 5/i.test(document.body.innerText)`, 5000));
    await evalJs(`(() => { const a = document.querySelector('#sa-reason');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(a, ${JSON.stringify(reason)});
      a.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
    await sleep(200);
    await evalJs(`${buttonNamed("Confirmar rechazo")}.click(); true`);
    out.flash = await waitFor(`(() => { const m = document.body.innerText.match(/vuelve a proceso; el técnico fue notificado\\. Constancia de rechazo (VD-\\d{8}-[0-9A-F]{8})/); return m ? m[1] : null; })()`, 20000);
    out.ok = out.reviewOpened && out.reasonRequired && !!out.flash;
  } else if (mode === "historyprint") {
    const [ticketId, number] = [arg1, arg2];
    await send("Page.navigate", { url: `${FRONTEND}/mis-aceptados?openTicket=${ticketId}` });
    const button = `[...document.querySelectorAll("button")].find((b) => /Imprimir historial/.test(b.textContent) && !b.disabled)`;
    out.modalOpened = !!(await waitFor(`!!${button}`, 30000));
    await evalJs(INTERCEPT_PRINT);
    await evalJs(`${button}.click(); true`);
    const html = await waitFor(`window.__printed`, 10000);
    await sleep(1000);
    out.openCalls = await evalJs(`window.__openCalls`);
    out.pages = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((x) => x.type === "page").length;
    out.printCalls = await evalJs(`window.__printCalls`);
    out.hasTicket = !!html?.includes(number);
    out.ok = out.modalOpened && out.openCalls === 0 && out.pages === 1 && out.printCalls === 1 && out.hasTicket;
  } else {
    throw new Error(`modo desconocido: ${mode}`);
  }
} catch (err) {
  out.error = String(err?.message ?? err);
} finally {
  try { ws?.close(); } catch {}
  chrome.kill();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
console.log(JSON.stringify(out));
process.exit(out.ok ? 0 : 1);
