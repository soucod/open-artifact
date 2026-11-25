export const waitForNextTask = (): Promise<void> =>
  new Promise<void>((resolve) => {
    let { port1: receiver, port2: sender } = new MessageChannel();
    receiver.addEventListener('message', () => {
      receiver.close();
      resolve();
    });
    receiver.start();
    sender.postMessage(null);
  });
