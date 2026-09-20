import { EventEmitter } from 'node:events';
import type { StreamEvent } from './types.js';

export class EventBus extends EventEmitter {
  emitEvent(e: StreamEvent): void {
    this.emit('event', e);
  }
  onEvent(fn: (e: StreamEvent) => void): () => void {
    this.on('event', fn);
    return () => this.off('event', fn);
  }
}
