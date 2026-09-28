import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  FileText,
  FolderOpen,
  LoaderCircle,
  UploadCloud,
} from "lucide-react";

const API_BASE = "http://127.0.0.1:8000";

function UploadPage({ setDatasetInfo }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [error, setError] = useState("");
  const [uploadResult, setUploadResult] = useState(null);
  const [recentDatasets, setRecentDatasets] = useState([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [recentError, setRecentError] = useState("");
  const [openingDatasetId, setOpeningDatasetId] = useState(null);
  const resultRef = useRef(null);

  const loadRecentDatasets = useCallback(async () => {
    setRecentLoading(true);
    setRecentError("");

    try {
      const response = await fetch(`${API_BASE}/datasets?limit=8`);
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.detail || "Could not load recent datasets.");
      }

      setRecentDatasets(data?.datasets || []);
    } catch (requestError) {
      setRecentDatasets([]);
      setRecentError(requestError.message || "Could not load recent datasets.");
    } finally {
      setRecentLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecentDatasets();
  }, [loadRecentDatasets]);

  useEffect(() => {
    if (uploadResult) {
      resultRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [uploadResult]);

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Please select a CSV file.");
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
    setError("");
    setUploadResult(null);
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setError("Please select a CSV file first.");
      return;
    }

    const formData = new FormData();
    formData.append("file", selectedFile);

    try {
      const response = await fetch(`${API_BASE}/upload`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.detail || "Upload failed.");
      }

      setUploadResult(data);
      setDatasetInfo(data);
      setError("");
      await loadRecentDatasets();
    } catch (requestError) {
      console.error(requestError);
      setError(requestError.message || "Could not upload the file.");
    }
  };

  const handleOpenDataset = async (datasetId) => {
    setOpeningDatasetId(datasetId);
    setRecentError("");
    setError("");

    try {
      const response = await fetch(`${API_BASE}/datasets/${datasetId}/open`, {
        method: "POST",
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.detail || "Could not open the saved dataset.");
      }

      setSelectedFile(null);
      setUploadResult(data);
      setDatasetInfo(data);
    } catch (requestError) {
      setRecentError(
        requestError.message || "Could not open the saved dataset."
      );
    } finally {
      setOpeningDatasetId(null);
    }
  };

  const formatUploadedAt = (value) => {
    if (!value) return "Saved dataset";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Saved dataset";

    return date.toLocaleString();
  };

  return (
    <div className="upload-page">
      <h1>Upload The Dataset</h1>
      <p className="page-description">
        Upload a CSV dataset to begin your data analysis journey.
      </p>

      <div className="upload-card">
        <div className="upload-icon">
          <UploadCloud size={42} />
        </div>

        <h2>Upload your CSV file</h2>
        <p className="upload-card-description">
          Choose a CSV file from your device and start exploring your data.
        </p>

        <label className="upload-button">
          Choose File
          <input
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            hidden
          />
        </label>

        {error && <p className="upload-error">{error}</p>}

        {selectedFile && (
          <div className="upload-selection-row">
            <div className="selected-file">
              <FileText size={22} />
              <div className="selected-file-details">
                <strong>{selectedFile.name}</strong>
                <p>{(selectedFile.size / 1024).toFixed(2)} KB</p>
              </div>
            </div>

            <button className="send-upload-button" onClick={handleUpload}>
              Upload Dataset
            </button>
          </div>
        )}

        {uploadResult && (
          <div ref={resultRef} className="upload-success-toast">
            <div className="upload-success-left">
              <CheckCircle2 size={22} />
              <span>{uploadResult.filename} ready</span>
            </div>

            <div className="upload-success-stats">
              {uploadResult.rows.toLocaleString()} rows, {uploadResult.columns} cols
            </div>
          </div>
        )}
      </div>

      <section className="recent-datasets-section">
        <div className="recent-datasets-heading">
          <div>
            <span className="recent-datasets-eyebrow">Saved in MySQL</span>
            <h2>Recent Uploads</h2>
            <p>Open a previous CSV without uploading it again.</p>
          </div>
          <Clock3 size={22} />
        </div>

        {recentError && <p className="recent-datasets-error">{recentError}</p>}

        {recentLoading ? (
          <div className="recent-datasets-loading">
            <LoaderCircle size={20} />
            Loading recent datasets...
          </div>
        ) : recentDatasets.length === 0 ? (
          <div className="recent-datasets-empty">
            <FolderOpen size={26} />
            <div>
              <strong>No saved datasets yet</strong>
              <span>Your uploaded CSV files will appear here.</span>
            </div>
          </div>
        ) : (
          <div className="recent-datasets-list">
            {recentDatasets.map((dataset) => (
              <article className="recent-dataset-row" key={dataset.id}>
                <div className="recent-dataset-file-icon">
                  <FileText size={20} />
                </div>

                <div className="recent-dataset-info">
                  <strong title={dataset.filename}>{dataset.filename}</strong>
                  <span>{formatUploadedAt(dataset.uploaded_at)}</span>
                </div>

                <div className="recent-dataset-stats">
                  <span>{Number(dataset.rows || 0).toLocaleString()} rows</span>
                  <span>{Number(dataset.columns || 0).toLocaleString()} cols</span>
                </div>

                <button
                  type="button"
                  className="recent-dataset-open"
                  onClick={() => handleOpenDataset(dataset.id)}
                  disabled={openingDatasetId !== null}
                >
                  {openingDatasetId === dataset.id ? (
                    <LoaderCircle size={16} />
                  ) : (
                    <FolderOpen size={16} />
                  )}
                  {openingDatasetId === dataset.id ? "Opening..." : "Load"}
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default UploadPage;
