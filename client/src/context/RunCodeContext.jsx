import axiosInstance from "@/api/pistonApi";
import langMap from "lang-map";
import { createContext, useContext, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useFileSystem } from "./FileContext";

const RunCodeContext = createContext(null);

export const useRunCode = () => {
  const context = useContext(RunCodeContext);

  if (!context) {
    throw new Error("useRunCode must be used within RunCodeContextProvider");
  }

  return context;
};

const RunCodeContextProvider = ({ children }) => {
  const { activeFile } = useFileSystem();

  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [supportedLanguages, setSupportedLanguages] = useState([]);
  const [selectedLanguage, setSelectedLanguage] = useState({
    language: "",
    version: "",
    aliases: [],
  });

  // Fetch supported languages
  useEffect(() => {
    const fetchSupportedLanguages = async () => {
      try {
        const response = await axiosInstance.get("/runtimes");

        console.log("Piston Response:", response.data);

        if (Array.isArray(response.data)) {
          setSupportedLanguages(response.data);
        } else {
          console.error("Expected array but got:", response.data);
          setSupportedLanguages([]);
          toast.error("Invalid response from Piston API");
        }
      } catch (error) {
        console.error(error);
        toast.error("Failed to fetch supported languages");
        setSupportedLanguages([]);
      }
    };

    fetchSupportedLanguages();
  }, []);

  // Select language from file extension
  useEffect(() => {
    if (!activeFile?.name) return;
    if (!Array.isArray(supportedLanguages) || supportedLanguages.length === 0)
      return;

    const extension = activeFile.name.split(".").pop()?.toLowerCase();

    if (!extension) {
      setSelectedLanguage({
        language: "",
        version: "",
        aliases: [],
      });
      return;
    }

    const languageNames = langMap.languages(extension) || [];

    const language = supportedLanguages.find((lang) => {
      const aliases = Array.isArray(lang.aliases) ? lang.aliases : [];

      return (
        aliases.includes(extension) ||
        languageNames.some((name) =>
          name.toLowerCase().includes(lang.language.toLowerCase())
        )
      );
    });

    if (language) {
      setSelectedLanguage(language);
    }
  }, [activeFile, supportedLanguages]);

  // Run code
  const runCode = async () => {
    if (!activeFile) {
      toast.error("Please open a file.");
      return;
    }

    if (!selectedLanguage.language) {
      toast.error("Language not detected.");
      return;
    }

    try {
      setIsRunning(true);

      toast.loading("Running code...");

      const response = await axiosInstance.post("/execute", {
        language: selectedLanguage.language,
        version: selectedLanguage.version,
        files: [
          {
            name: activeFile.name,
            content: activeFile.content,
          },
        ],
        stdin: input,
      });

      toast.dismiss();

      if (response.data?.run?.stderr) {
        setOutput(response.data.run.stderr);
      } else {
        setOutput(response.data?.run?.stdout || "");
      }
    } catch (error) {
      toast.dismiss();

      console.error(error);

      setOutput(
        error?.response?.data?.message ||
          "Error while executing code."
      );

      toast.error("Failed to run code");
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <RunCodeContext.Provider
      value={{
        input,
        setInput,
        output,
        isRunning,
        supportedLanguages,
        selectedLanguage,
        setSelectedLanguage,
        runCode,
      }}
    >
      {children}
    </RunCodeContext.Provider>
  );
};

export default RunCodeContext;
export { RunCodeContextProvider };