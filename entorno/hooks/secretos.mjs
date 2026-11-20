// Patrones de secretos, sin efectos al importar: los usan seguridad.mjs y apuntes-sesion.mjs.
export const SECRETOS = [
  [/x-access-token:(?!\$)[^@\s"']{8,}@/, 'token en una URL de git (x-access-token:)'],
  [/https?:\/\/[^\s/:@"']+:(?!\$)[^\s/@"']{8,}@/, 'usuario y clave en una URL'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/, 'token de GitHub (github_pat_)'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'token de GitHub (ghp_/gho_/ghs_...)'],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, 'clave de API de Anthropic'],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/, 'clave de API (sk-...)'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'clave de acceso de AWS'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/, 'token de Slack'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'clave de API de Google'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'clave privada'],
];
export const buscaSecreto = txt => SECRETOS.find(([re]) => re.test(txt))?.[1] ?? null;
export const tapaSecretos = txt => SECRETOS.reduce((t, [re]) => t.replace(new RegExp(re.source, 'g'), '[SECRETO]'), txt);
