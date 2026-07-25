import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export async function evaluateHand(cards) {
  const { data } = await axios.post(`${API}/evaluate`, { cards });
  return data;
}
