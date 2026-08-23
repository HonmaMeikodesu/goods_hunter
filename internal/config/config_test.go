package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadUsesLowDependencyDefaults(t *testing.T) {
	privateDir := t.TempDir()
	t.Setenv("GH_PRIVATE_DIR", privateDir)
	t.Setenv("GH_LISTEN_ADDRESS", ":8123")
	t.Setenv("GH_SERVER_HOST", "")
	t.Setenv("GH_MAIL_MODE", "log")
	t.Setenv("GH_DATA_FILE", filepath.Join(t.TempDir(), "state.json"))
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.BaseURL != "http://localhost:8123" {
		t.Fatalf("BaseURL = %q", cfg.BaseURL)
	}
	if cfg.MailMode != "log" || cfg.SessionTTL <= 0 || cfg.RegistrationTTL <= 0 {
		t.Fatalf("unexpected defaults: %#v", cfg)
	}
}

func TestLoadRejectsMalformedExistingPrivateFile(t *testing.T) {
	privateDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(privateDir, "server.json"), []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GH_PRIVATE_DIR", privateDir)
	if _, err := Load(); err == nil {
		t.Fatal("Load() unexpectedly accepted malformed server.json")
	}
}
