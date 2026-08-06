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
