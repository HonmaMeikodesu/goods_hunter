// Package cipher implements the legacy AES-GCM proxy payload format using only
// the Go standard library.
package cipher

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"

	"github.com/HonmaMeikodesu/goods_hunter/internal/problem"
)

type PayloadData struct {
	IV      string `json:"iv"`
	Message string `json:"message"`
}

type Payload struct {
	Digest string      `json:"digest"`
	Data   PayloadData `json:"data"`
}

type Module struct {
	aead cipher.AEAD
}

func New(key []byte) (*Module, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("initialize AES cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("initialize AES-GCM: %w", err)
	}
	return &Module{aead: aead}, nil
}

func (m *Module) Encode(message string) (Payload, error) {
	iv := make([]byte, m.aead.NonceSize())
	if _, err := rand.Read(iv); err != nil {
		return Payload{}, fmt.Errorf("generate AES-GCM nonce: %w", err)
	}
	ciphertext := m.aead.Seal(nil, iv, []byte(message), nil)
	data := PayloadData{IV: hex.EncodeToString(iv), Message: hex.EncodeToString(ciphertext)}
	digest, err := digestData(data)
	if err != nil {
		return Payload{}, err
	}
	return Payload{Digest: digest, Data: data}, nil
}

func (m *Module) Decode(payload Payload) (string, error) {
	digest, err := digestData(payload.Data)
	if err != nil {
		return "", err
	}
	expected, err := hex.DecodeString(payload.Digest)
	if err != nil || len(expected) != sha256.Size {
		return "", problem.ErrMessageCorrupted
	}
	actual, _ := hex.DecodeString(digest)
	if subtle.ConstantTimeCompare(expected, actual) != 1 {
		return "", problem.ErrMessageCorrupted
	}
	iv, err := hex.DecodeString(payload.Data.IV)
	if err != nil || len(iv) != m.aead.NonceSize() {
		return "", problem.ErrMessageCorrupted
	}
	ciphertext, err := hex.DecodeString(payload.Data.Message)
	if err != nil {
		return "", problem.ErrMessageCorrupted
	}
	plaintext, err := m.aead.Open(nil, iv, ciphertext, nil)
	if err != nil {
		return "", problem.ErrMessageCorrupted
	}
	return string(plaintext), nil
}

func digestData(data PayloadData) (string, error) {
	raw, err := json.Marshal(data)
	if err != nil {
		return "", fmt.Errorf("encode cipher payload: %w", err)
	}
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:]), nil
}
