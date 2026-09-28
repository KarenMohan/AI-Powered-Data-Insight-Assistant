import { useEffect, useState } from "react";
import Sidebar from "./components/Sidebar";
import UploadPage from "./pages/UploadPage";
import DashboardPage from "./pages/DashboardPage";
import DataQualityPage from "./pages/DataQualityPage";
import DataVisualizationPage from "./pages/DataVisualizationPage";
import ChatbotPage from "./pages/ChatbotPage";
import LoginPage from "./pages/LoginPage";
import "./App.css";

const API_BASE = "http://127.0.0.1:8000";

const initialVisualizationState = {
  chartType: "bar",
  xColumn: "",
  yColumn: "",
  groupColumn: "",
  chartData: [],
  groups: [],
  error: "",
};

const initialChatMessages = [
  {
    role: "assistant",
    text: "Hi ! Ask me anything about your uploaded dataset.",
  },
];

function App() {
  const [activePage, setActivePage] = useState("Upload");
  const [datasetInfo, setDatasetInfo] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [datasetSummary, setDatasetSummary] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState(initialChatMessages);
  const [visualizationState, setVisualizationState] = useState(
    initialVisualizationState
  );

  useEffect(() => {
    const restoreLogin = async () => {
      const token = sessionStorage.getItem("auth_token");

      if (!token) {
        setAuthLoading(false);
        return;
      }

      try {
        const response = await fetch(`${API_BASE}/auth/me`);

        if (!response.ok) {
          throw new Error("Session expired.");
        }

        const user = await response.json();
        setCurrentUser(user);
      } catch {
        sessionStorage.removeItem("auth_token");
        setCurrentUser(null);
      } finally {
        setAuthLoading(false);
      }
    };

    restoreLogin();
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [activePage]);

  useEffect(() => {
    setDatasetSummary("");
    setSummaryLoading(false);

    if (!datasetInfo) return undefined;

    const controller = new AbortController();

    const streamDatasetSummary = async () => {
      setSummaryLoading(true);
      let streamedText = "";

      try {
        const response = await fetch(`${API_BASE}/dataset-summary-stream`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("Could not generate dataset summary.");
        }

        if (!response.body) {
          throw new Error("Summary stream was not available.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();

          if (done) break;

          streamedText += decoder.decode(value, { stream: true });
          setDatasetSummary(streamedText);
        }

        streamedText += decoder.decode();
        setDatasetSummary(streamedText);
      } catch (error) {
        if (error.name !== "AbortError") {
          console.error("Could not stream dataset summary:", error);

          if (!streamedText) {
            setDatasetSummary(
              "The dataset summary could not be generated right now."
            );
          }
        }
      } finally {
        if (!controller.signal.aborted) {
          setSummaryLoading(false);
        }
      }
    };

    streamDatasetSummary();

    return () => controller.abort();
  }, [datasetInfo?.filename, datasetInfo?.dataset_id]);

  const handleAuthenticated = (data) => {
    sessionStorage.setItem("auth_token", data.access_token);
    setCurrentUser(data.user);
    setActivePage("Upload");
  };

  const handleLogout = () => {
    sessionStorage.removeItem("auth_token");
    setCurrentUser(null);
    setDatasetInfo(null);
    setDatasetSummary("");
    setSummaryLoading(false);
    setChatMessages(initialChatMessages);
    setVisualizationState({ ...initialVisualizationState });
    setActivePage("Upload");
  };

  const handleDatasetInfo = (data) => {
    setDatasetInfo(data);
    setVisualizationState({ ...initialVisualizationState });
  };

  if (authLoading) {
    return (
      <div className="auth-loading-screen">
        <div className="auth-loading-card">
          <div className="auth-loading-logo">AI</div>
          <strong>Loading workspace...</strong>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <LoginPage onAuthenticated={handleAuthenticated} />;
  }

  const chatbotMode =
    activePage === "Chatbot"
      ? "page"
      : activePage === "Upload"
        ? "hidden"
        : "floating";

  return (
    <div className={sidebarCollapsed ? "app sidebar-collapsed" : "app"}>
      <Sidebar
        activePage={activePage}
        setActivePage={setActivePage}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
        currentUser={currentUser}
        onLogout={handleLogout}
      />

      <main className="main-content">
        {activePage === "Upload" && (
          <UploadPage setDatasetInfo={handleDatasetInfo} />
        )}

        {activePage === "Dashboard" && (
          <DashboardPage
            datasetInfo={datasetInfo}
            datasetSummary={datasetSummary}
            summaryLoading={summaryLoading}
          />
        )}

        {activePage === "Data Quality" && (
          <DataQualityPage datasetInfo={datasetInfo} />
        )}

        {activePage === "Data Visualization" && (
          <DataVisualizationPage
            datasetInfo={datasetInfo}
            visualizationState={visualizationState}
            setVisualizationState={setVisualizationState}
          />
        )}

        <ChatbotPage
          datasetInfo={datasetInfo}
          messages={chatMessages}
          setMessages={setChatMessages}
          mode={chatbotMode}
          setActivePage={setActivePage}
        />
      </main>
    </div>
  );
}

export default App;
