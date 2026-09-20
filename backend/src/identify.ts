import { classifyIdentifyText } from './parse.js';
import { peekConsole } from './console.js';

export async function identifyPort(port: string): Promise<'pour' | 'sensors' | 'other'> {
  const text = await peekConsole(port);
  return classifyIdentifyText(text);
}
