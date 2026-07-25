import "./App.css";
import { Toaster } from "sonner";
import Evaluator from "./pages/Evaluator";

function App() {
  return (
    <div className="App">
      <Evaluator />
      <Toaster
        theme="dark"
        position="top-center"
        toastOptions={{
          style: {
            background: "#18181b",
            border: "1px solid #27272a",
            color: "#fafafa",
            fontFamily: "Manrope, sans-serif",
          },
        }}
      />
    </div>
  );
}

export default App;
