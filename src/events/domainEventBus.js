import { EventEmitter } from 'events';

// Decouples source modules (Friend, Group) from both real-time delivery
// and notification persistence — neither Friend System nor Group System
// needs to know sockets or Notifications exist. They publish; Real-Time
// and Notification System each subscribe independently.
export const domainEventBus = new EventEmitter();
domainEventBus.setMaxListeners(50); // headroom as more subscribers are added
