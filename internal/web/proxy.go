package web

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
)

type proxyConfig struct {
	path string
	aead cipher.AEAD
}

type proxyPayload struct {
	Digest string `json:"digest"`
	Data   struct {
		IV      string `json:"iv"`
		Message string `json:"message"`
	} `json:"data"`
}

func (p proxyConfig) payload() (proxyPayload, error) {
	var payload proxyPayload
	if p.aead == nil {
		return payload, errors.New("proxy encryption key is not configured")
	}
	f, err := os.Open(p.path)
	if err != nil {
		return payload, err
	}
	defer f.Close()
	const limit = 2 << 20
	raw, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil {
		return payload, err
	}
	if len(raw) > limit {
		return payload, errors.New("proxy configuration is too large")
	}
	// Go's random-nonce GCM lets the wire protocol keep a separate IV field.
	sealed := p.aead.Seal(nil, nil, raw, nil)
	payload.Data.IV = hex.EncodeToString(sealed[:12])
	payload.Data.Message = hex.EncodeToString(sealed[12:])
	encoded, _ := json.Marshal(payload.Data)
	sum := sha256.Sum256(encoded)
	payload.Digest = hex.EncodeToString(sum[:])
	return payload, nil
}

func newProxyConfig(path string, key []byte) (proxyConfig, error) {
	if len(key) == 0 {
		return proxyConfig{path: path}, nil
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return proxyConfig{}, err
	}
	aead, err := cipher.NewGCMWithRandomNonce(block)
	return proxyConfig{path: path, aead: aead}, err
}
