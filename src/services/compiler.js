const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const { DATA_DIR } = require('../data/store');

const WORK_DIR = path.join(DATA_DIR, 'work');
const DELIVER_DIR = path.join(DATA_DIR, 'deliver');

let compilerInfo = { configured: false, path: null };

function initCompiler() {
  const p = process.env.AMXXPC_PATH;
  if (p && fs.existsSync(p)) {
    compilerInfo = { configured: true, path: p };
    console.log('[Compiler] AMXX Compiler configurado em:', p);
  } else {
    compilerInfo = { configured: false, path: null };
    console.warn('[Compiler] AMXXPC_PATH não configurado.');
    console.warn('  O compilador AMXX (amxxpc) é OBRIGATÓRIO para vender .amxx.');
    console.warn('  Configure AMXXPC_PATH no .env apontando para o executável do compilador.');
    console.warn('  (Render: /app/compiler/addons/amxmodx/scripting/amxxpc)');
  }
  if (!fs.existsSync(WORK_DIR)) fs.mkdirSync(WORK_DIR, { recursive: true });
  if (!fs.existsSync(DELIVER_DIR)) fs.mkdirSync(DELIVER_DIR, { recursive: true });
}

function prepareSource(originalPath, customTag) {
  let code;
  try {
    code = fs.readFileSync(originalPath, 'utf8');
  } catch (e) {
    throw new Error('Não foi possível ler o arquivo .sma de origem do plugin.');
  }

  if (customTag) {
    code = applyTag(code, customTag);
  }

  return code;
}

/**
 * Aplica a tag customizada ao código .sma.
 *
 * 1) Procura tags entre colchetes (ex: "[TRS]", "[LojaCS]") nas strings
 *    de chat / defines e troca TODAS pela tag do comprador.
 * 2) Troca também o nome do plugin (register_plugin e #define PLUGIN/NAME/TAG).
 */
function applyTag(code, tag) {
  // Tag sem os colchetes (ex: "[TRS]" -> "TRS")
  const cleanTag = tag.trim().replace(/^\[|\]$/g, '');
  let modified = code;

  // 1. Tags entre colchetes dentro de strings (prefixos de chat, mensagens)
  //    Ex: "["TRS"] %s", "rcon[TRS]", "^1[TRS]^4 ..."
  //    Só substitui tokens que parecem tag (letras/números/_, sem %, sem ^, sem dígitos puros)
  const bracketToken = /([\[\(])([A-Za-z][A-Za-z0-9_]{0,15})([\]\)])/g;
  modified = modified.replace(/"(?:[^"\\]|\\.)*"/g, (str) => {
    return str.replace(bracketToken, (m, open, content, close) => {
      // ignora se for caractere de cor amxx (ex: [^1]) ou formato (ex: [%.1f])
      if (content.includes('^') || content.includes('%')) return m;
      return `${open}${cleanTag}${close}`;
    });
  });

  // 2. Tags entre colchetes fora de strings, apenas em #define
  //    Ex: #define TAG [TRS]
  modified = modified.replace(/(#define\s+[A-Za-z0-9_]+\s+)(\[[A-Za-z][A-Za-z0-9_]{0,15}\])/g,
    (m, pre, br) => `${pre}[${cleanTag}]`);

  // 3. register_plugin("Nome", ...) -> troca o primeiro argumento
  modified = modified.replace(/register_plugin\(\s*"([^"]*)"\s*,/g,
    () => `register_plugin("${cleanTag}",`);

  // 4. Diretiva #define de nome do plugin (já pode ter sido trocada no passo 1/2)
  modified = modified.replace(/#define\s+(PLUGIN|PLUGIN_NAME|NAME|TAG|PLUGIN_TAG)\s+"[^"]*"/gi,
    (m, name) => `#define ${name} "${cleanTag}"`);

  // 5. Variável nomeada de plugin (ex: new PluginName[] = "...";)
  modified = modified.replace(/(new\s+\w*(?:name|tag|plugin)\w*\[\]\s*=\s*)"[^"]*"/gi,
    (m, prefix) => `${prefix}"${cleanTag}"`);

  // Comentário identificando a personalização
  modified = `/* Plugin personalizado - tag: ${cleanTag} */\n` + modified;

  return modified;
}

/**
 * Compila o .sma para .amxx usando o amxxpc.
 */
function compileSma(smaPath) {
  return new Promise((resolve) => {
    if (!compilerInfo.configured) {
      resolve({ success: false, reason: 'compiler-not-configured', output: '' });
      return;
    }

    const outDir = path.dirname(smaPath);
    const outFile = path.join(outDir, path.basename(smaPath).replace(/\.sma$/i, '.amxx'));
    const cmd = `"${compilerInfo.path}" "${smaPath}" -o"${outFile}"`;

    exec(cmd, { timeout: 60000, maxBuffer: 1024 * 1024 * 2 }, (error, stdout, stderr) => {
      const output = String(stdout || '') + String(stderr || '');
      if (error) {
        resolve({ success: false, reason: 'compile-error', output });
      } else {
        resolve({ success: true, output });
      }
    });
  });
}

/**
 * Processa um pedido: gera o .sma com a tag e compila para .amxx (entrega OBRIGATÓRIA do .amxx).
 *
 * Retorna:
 *   { type: 'amxx', path, }                       -> compilado com sucesso
 *   { type: 'pending', smaPath, output, reason }  -> não compilou (.amxx fica pendente no admin)
 */
async function deliverPlugin(plugin, customTag) {
  const id = uuidv4();
  const baseName = (plugin.name || 'plugin').replace(/[^a-zA-Z0-9_-]/g, '_');

  // Pasta temporária de trabalho
  const workDir = path.join(WORK_DIR, id);
  fs.mkdirSync(workDir, { recursive: true });

  const sourcePath = plugin.sourceFile;

  // 1. Gerar o .sma com a tag
  const smaCode = prepareSource(sourcePath, customTag);
  const smaPath = path.join(workDir, `${baseName}.sma`);
  fs.writeFileSync(smaPath, smaCode);

  // 2. Compilar
  const result = await compileSma(smaPath);

  if (result.success) {
    const amxxPath = path.join(workDir, `${baseName}.amxx`);
    if (fs.existsSync(amxxPath)) {
      const finalPath = path.join(DELIVER_DIR, `${baseName}_${id.slice(0, 8)}.amxx`);
      fs.copyFileSync(amxxPath, finalPath);
      return { type: 'amxx', path: finalPath, smaPath, output: result.output };
    }
    return { type: 'pending', smaPath, output: result.output, reason: 'output-not-found' };
  }

  // Não compilou: guarda o .sma com a tag para o admin compilar manualmente
  const pendingSmaPath = path.join(WORK_DIR, id, `${baseName}_tag.sma`);
  fs.copyFileSync(smaPath, pendingSmaPath);
  return {
    type: 'pending',
    smaPath: pendingSmaPath,
    output: result.output,
    reason: result.reason
  };
}

function isCompilerConfigured() {
  return compilerInfo.configured;
}

module.exports = { initCompiler, deliverPlugin, prepareSource, applyTag, isCompilerConfigured };