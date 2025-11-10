/**
 * Planner event bus for calendar ↔ palette sync
 * Lightweight EventTarget-based pub/sub with optional BroadcastChannel support
 */

export type PlannerEventType = 'SCHEDULED' | 'RESCHEDULED' | 'UNSCHEDULED'

export interface PlannerEventPayload {
  type: PlannerEventType
  episodeId: string
  scheduledAt?: string // ISO string (undefined for UNSCHEDULED)
  timestamp: number // Date.now() when event fired
}

class PlannerBus extends EventTarget {
  private broadcastChannel: BroadcastChannel | null = null
  private enableBroadcast: boolean

  constructor(enableBroadcast = false) {
    super()
    this.enableBroadcast = enableBroadcast

    // Setup BroadcastChannel if enabled and supported
    if (enableBroadcast && typeof BroadcastChannel !== 'undefined') {
      this.broadcastChannel = new BroadcastChannel('planner')
      this.broadcastChannel.onmessage = (e) => {
        console.debug('[plannerBus] Received from other tab:', e.data)
        // Re-dispatch locally (don't re-broadcast)
        this.dispatchEvent(new CustomEvent(e.data.type, { detail: e.data }))
      }
    }
  }

  /**
   * Emit SCHEDULED event (episode dropped/added to calendar)
   */
  emitScheduled(episodeId: string, scheduledAt: string) {
    const payload: PlannerEventPayload = {
      type: 'SCHEDULED',
      episodeId,
      scheduledAt,
      timestamp: Date.now(),
    }
    this.emit(payload)
  }

  /**
   * Emit RESCHEDULED event (episode moved/resized on calendar)
   */
  emitRescheduled(episodeId: string, scheduledAt: string) {
    const payload: PlannerEventPayload = {
      type: 'RESCHEDULED',
      episodeId,
      scheduledAt,
      timestamp: Date.now(),
    }
    this.emit(payload)
  }

  /**
   * Emit UNSCHEDULED event (episode removed from calendar)
   */
  emitUnscheduled(episodeId: string) {
    const payload: PlannerEventPayload = {
      type: 'UNSCHEDULED',
      episodeId,
      timestamp: Date.now(),
    }
    this.emit(payload)
  }

  /**
   * Internal emit with broadcast support
   */
  private emit(payload: PlannerEventPayload) {
    console.debug('[plannerBus.emit]', {
      type: payload.type,
      episodeId: payload.episodeId,
      when: payload.scheduledAt || 'null',
    })

    // Dispatch locally
    this.dispatchEvent(new CustomEvent(payload.type, { detail: payload }))

    // Broadcast to other tabs
    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage(payload)
    }
  }

  /**
   * Subscribe to planner events
   */
  on(type: PlannerEventType, handler: (payload: PlannerEventPayload) => void) {
    const listener = (e: Event) => {
      const customEvent = e as CustomEvent<PlannerEventPayload>
      handler(customEvent.detail)
    }
    this.addEventListener(type, listener)
    return () => this.off(type, listener)
  }

  /**
   * Unsubscribe from planner events
   */
  off(type: PlannerEventType, listener: EventListener) {
    this.removeEventListener(type, listener)
  }

  /**
   * Cleanup resources
   */
  destroy() {
    if (this.broadcastChannel) {
      this.broadcastChannel.close()
      this.broadcastChannel = null
    }
  }
}

// Singleton instance (BroadcastChannel disabled for V1)
export const plannerBus = new PlannerBus(false) // Set to `true` to enable cross-tab sync
