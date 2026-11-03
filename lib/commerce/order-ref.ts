/** Short order reference shown to buyers and creators: last 6 letters/digits of our order id. */
export const orderRef = (orderId: string) => orderId.replace(/[^a-z0-9]/gi, "").slice(-6).toUpperCase();
