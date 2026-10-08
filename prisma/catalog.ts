/**
 * Partner catalog seed data. The first six items (`demo: true`) are the ones that
 * appear in the self-recorded demo video, and their attributes describe what the
 * vision model will actually see on screen, which is what makes matching reliable.
 * Prices are integer cents.
 */

export interface SeedMerchant {
  id: string;
  name: string;
}

export interface SeedProduct {
  id: string;
  merchantId: string;
  title: string;
  description: string;
  category: string;
  priceMinor: number;
  attributes: Record<string, string>;
  stock: number;
  demo?: boolean;
}

export const merchants: SeedMerchant[] = [
  { id: "seed_merchant_northloop", name: "Northloop Apparel" },
  { id: "seed_merchant_signal", name: "Studio Signal" },
  { id: "seed_merchant_kiln", name: "Kiln & Co. Home" },
];

const N = "seed_merchant_northloop";
const S = "seed_merchant_signal";
const K = "seed_merchant_kiln";

export const products: SeedProduct[] = [
  // ── The six demo-video items ──
  {
    id: "seed_prod_black_hoodie",
    merchantId: N,
    title: "Everyday Oversized Hoodie: Black",
    description: "Heavyweight cotton fleece hoodie with a relaxed, oversized fit and kangaroo pocket.",
    category: "apparel/hoodie",
    priceMinor: 4500,
    attributes: { color: "black", material: "cotton fleece", style: "oversized" },
    stock: 40,
    demo: true,
  },
  {
    id: "seed_prod_wireless_mic",
    merchantId: S,
    title: "Clip-On Wireless Mic Kit",
    description: "Dual-channel wireless lavalier microphone with charging case, for phones and cameras.",
    category: "electronics/microphone",
    priceMinor: 6900,
    attributes: { color: "black", type: "wireless lavalier", connectivity: "2.4GHz" },
    stock: 25,
    demo: true,
  },
  {
    id: "seed_prod_ceramic_mug",
    merchantId: K,
    title: "Speckled Stoneware Mug",
    description: "Hand-glazed 12oz ceramic mug with a speckled cream finish. Dishwasher safe.",
    category: "home/mug",
    priceMinor: 2200,
    attributes: { color: "cream speckled", material: "stoneware ceramic", capacity: "12oz" },
    stock: 60,
    demo: true,
  },
  {
    id: "seed_prod_desk_lamp",
    merchantId: S,
    title: "Arc LED Desk Lamp",
    description: "Dimmable LED desk lamp with an adjustable arm and warm-to-cool color temperature.",
    category: "home/lamp",
    priceMinor: 5400,
    attributes: { color: "matte black", type: "LED desk lamp", style: "adjustable arm" },
    stock: 18,
    demo: true,
  },
  {
    id: "seed_prod_white_sneakers",
    merchantId: N,
    title: "Court Low Sneakers: White",
    description: "Minimal low-top leather sneakers with a cushioned sole.",
    category: "footwear/sneakers",
    priceMinor: 8900,
    attributes: { color: "white", material: "leather", style: "low-top" },
    stock: 30,
    demo: true,
  },
  {
    id: "seed_prod_sunglasses",
    merchantId: N,
    title: "Round Tortoise Sunglasses",
    description: "Round acetate sunglasses with a tortoiseshell frame and UV400 lenses.",
    category: "accessories/sunglasses",
    priceMinor: 3500,
    attributes: { color: "tortoiseshell", shape: "round", lens: "UV400" },
    stock: 50,
    demo: true,
  },

  // ── Rest of the catalog (gives search something to rank against) ──
  {
    id: "seed_prod_grey_hoodie",
    merchantId: N,
    title: "Everyday Oversized Hoodie: Heather Grey",
    description: "The same heavyweight fleece hoodie in heather grey.",
    category: "apparel/hoodie",
    priceMinor: 4500,
    attributes: { color: "heather grey", material: "cotton fleece", style: "oversized" },
    stock: 35,
  },
  {
    id: "seed_prod_tee",
    merchantId: N,
    title: "Heavy Cotton Tee: White",
    description: "Boxy-fit 240gsm cotton t-shirt.",
    category: "apparel/t-shirt",
    priceMinor: 2400,
    attributes: { color: "white", material: "cotton", style: "boxy" },
    stock: 80,
  },
  {
    id: "seed_prod_beanie",
    merchantId: N,
    title: "Ribbed Knit Beanie",
    description: "Soft ribbed beanie in merino blend.",
    category: "accessories/beanie",
    priceMinor: 1800,
    attributes: { color: "olive", material: "merino blend" },
    stock: 45,
  },
  {
    id: "seed_prod_cap",
    merchantId: N,
    title: "Washed Canvas Cap",
    description: "Six-panel unstructured cap with adjustable strap.",
    category: "accessories/cap",
    priceMinor: 2000,
    attributes: { color: "navy", material: "washed canvas" },
    stock: 40,
  },
  {
    id: "seed_prod_black_sneakers",
    merchantId: N,
    title: "Court Low Sneakers: Black",
    description: "Minimal low-top leather sneakers in black.",
    category: "footwear/sneakers",
    priceMinor: 8900,
    attributes: { color: "black", material: "leather", style: "low-top" },
    stock: 22,
  },
  {
    id: "seed_prod_headphones",
    merchantId: S,
    title: "Studio Over-Ear Headphones",
    description: "Closed-back over-ear headphones for monitoring and editing.",
    category: "electronics/headphones",
    priceMinor: 9900,
    attributes: { color: "black", type: "over-ear", connectivity: "wired" },
    stock: 15,
  },
  {
    id: "seed_prod_ring_light",
    merchantId: S,
    title: '10" Ring Light with Stand',
    description: "Dimmable ring light with phone holder and tripod stand.",
    category: "electronics/lighting",
    priceMinor: 3900,
    attributes: { color: "white", type: "ring light", size: "10 inch" },
    stock: 28,
  },
  {
    id: "seed_prod_webcam",
    merchantId: S,
    title: "1080p Streaming Webcam",
    description: "Full-HD webcam with privacy shutter and dual mics.",
    category: "electronics/webcam",
    priceMinor: 5900,
    attributes: { color: "black", resolution: "1080p" },
    stock: 20,
  },
  {
    id: "seed_prod_usb_mic",
    merchantId: S,
    title: "Desktop USB Condenser Mic",
    description: "Cardioid USB microphone with desk stand, for podcasts and streams.",
    category: "electronics/microphone",
    priceMinor: 7900,
    attributes: { color: "silver", type: "usb condenser" },
    stock: 12,
  },
  {
    id: "seed_prod_tumbler",
    merchantId: K,
    title: "Insulated Steel Tumbler",
    description: "20oz double-wall stainless tumbler with lid.",
    category: "home/drinkware",
    priceMinor: 2800,
    attributes: { color: "sage green", material: "stainless steel", capacity: "20oz" },
    stock: 50,
  },
  {
    id: "seed_prod_glass_mug",
    merchantId: K,
    title: "Double-Wall Glass Mug",
    description: "Heat-resistant borosilicate glass mug, 10oz.",
    category: "home/mug",
    priceMinor: 1900,
    attributes: { color: "clear", material: "borosilicate glass", capacity: "10oz" },
    stock: 40,
  },
  {
    id: "seed_prod_planter",
    merchantId: K,
    title: "Ceramic Desk Planter",
    description: "Small glazed planter with drainage tray.",
    category: "home/planter",
    priceMinor: 2600,
    attributes: { color: "terracotta", material: "ceramic" },
    stock: 33,
  },
  {
    id: "seed_prod_candle",
    merchantId: K,
    title: "Cedar & Smoke Soy Candle",
    description: "Hand-poured soy candle in a reusable amber jar.",
    category: "home/candle",
    priceMinor: 2400,
    attributes: { color: "amber", scent: "cedar smoke" },
    stock: 70,
  },
  {
    id: "seed_prod_floor_lamp",
    merchantId: K,
    title: "Linen Shade Floor Lamp",
    description: "Tall floor lamp with a natural linen drum shade.",
    category: "home/lamp",
    priceMinor: 11900,
    attributes: { color: "natural linen", type: "floor lamp" },
    stock: 8,
  },
];
