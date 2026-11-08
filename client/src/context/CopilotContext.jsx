import { createContext, useContext, useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";

const CopilotContext = createContext(null);

// eslint-disable-next-line react-refresh/only-export-components
export const useCopilot = () => {
	const context = useContext(CopilotContext);
	if (context === null) {
		throw new Error("useCopilot must be used within a CopilotContextProvider");
	}
	return context;
};

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3000";

const CopilotContextProvider = ({ children }) => {
	const [input, setInput] = useState("");
	const [output, setOutput] = useState("");
	const [isRunning, setIsRunning] = useState(false);

	const generateCode = async () => {
		if (!input.trim()) {
			toast.error("Please write a prompt");
			return;
		}

		setIsRunning(true);
		setOutput("");
		toast.loading("Generating code...");

		try {
			const response = await axios.post(
				`${API_BASE_URL}/api/copilot/generate`,
				{ prompt: input },
				{ headers: { "Content-Type": "application/json" } },
			);

			if (response.data?.success) {
				setOutput(response.data.result);
				toast.dismiss();
				toast.success("Code generated successfully");
			} else {
				throw new Error(response.data?.message || "Failed to generate code");
			}
		} catch (error) {
			console.error("Error generating code:", error);
			toast.dismiss();
			toast.error("Failed to generate the code");
			setOutput("");
		} finally {
			setIsRunning(false);
		}
	};

	return (
		<CopilotContext.Provider
			value={{ input, setInput, output, isRunning, generateCode }}
		>
			{children}
		</CopilotContext.Provider>
	);
};

export { CopilotContextProvider };
export default CopilotContext;