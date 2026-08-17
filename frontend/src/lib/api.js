import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export async function evaluateHand(cards) {
  const { data } = await axios.post(`${API}/evaluate`, { cards });
  return data;
}

export async function recognizeCards(file) {
  const form = new FormData();
  form.append("file", file);
  const { data } = await axios.post(`${API}/recognize-cards`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data.cards;
}

export async function scanFrame(file) {
  const form = new FormData();
  form.append("file", file);
  const { data } = await axios.post(`${API}/scan-frame`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data.cards;
}

export async function scanCardZones(files) {
  const form = new FormData();
  files.forEach((file) => form.append("files", file));
  const { data } = await axios.post(`${API}/scan-zones`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function saveHand(cards, source = "camera") {
  const payload = cards.map((c) => ({ rank: c.rank, suit: c.suit }));
  const { data } = await axios.post(`${API}/hands`, { cards: payload, source });
  return data;
}

export async function getHands(limit = 50) {
  const { data } = await axios.get(`${API}/hands`, { params: { limit } });
  return data.hands;
}

export async function clearHands() {
  await axios.delete(`${API}/hands`);
}
