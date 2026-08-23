package accounts

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

const (
	passwordAlgorithm  = "pbkdf2-sha256"
	passwordIterations = 210_000
	passwordKeyLength  = 32
	passwordSaltLength = 16
)

func hashPassword(password string) (string, error) {
	salt := make([]byte, passwordSaltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate password salt: %w", err)
	}
	derived := pbkdf2SHA256([]byte(password), salt, passwordIterations, passwordKeyLength)
	return strings.Join([]string{
		passwordAlgorithm,
		strconv.Itoa(passwordIterations),
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(derived),
	}, "$"), nil
}

func verifyPassword(encoded, password string) (valid bool, legacy bool, err error) {
	parts := strings.Split(encoded, "$")
	if len(parts) == 4 && parts[0] == passwordAlgorithm {
		iterations, parseErr := strconv.Atoi(parts[1])
		if parseErr != nil || iterations < 1 || iterations > 10_000_000 {
			return false, false, errors.New("invalid password iteration count")
		}
		salt, decodeErr := base64.RawStdEncoding.DecodeString(parts[2])
		if decodeErr != nil || len(salt) < 8 {
			return false, false, errors.New("invalid password salt")
		}
		expected, decodeErr := base64.RawStdEncoding.DecodeString(parts[3])
		if decodeErr != nil || len(expected) < 16 || len(expected) > 64 {
			return false, false, errors.New("invalid password digest")
		}
		actual := pbkdf2SHA256([]byte(password), salt, iterations, len(expected))
		return subtle.ConstantTimeCompare(expected, actual) == 1, false, nil
	}

	// The TypeScript implementation stored an unsalted SHA-256 hex digest.
	// Accept it once so imported users can be upgraded after a successful login.
	if len(encoded) == sha256.Size*2 {
		expected, decodeErr := hex.DecodeString(encoded)
		if decodeErr != nil {
			return false, false, decodeErr
		}
		actual := sha256.Sum256([]byte(password))
		return subtle.ConstantTimeCompare(expected, actual[:]) == 1, true, nil
	}
	return false, false, errors.New("unsupported password digest")
}

func pbkdf2SHA256(password, salt []byte, iterations, keyLength int) []byte {
	hashLength := sha256.Size
	blocks := (keyLength + hashLength - 1) / hashLength
	result := make([]byte, 0, blocks*hashLength)
	for block := 1; block <= blocks; block++ {
		mac := hmac.New(sha256.New, password)
		_, _ = mac.Write(salt)
		_, _ = mac.Write([]byte{byte(block >> 24), byte(block >> 16), byte(block >> 8), byte(block)})
		u := mac.Sum(nil)
		t := append([]byte(nil), u...)
		for iteration := 1; iteration < iterations; iteration++ {
			mac = hmac.New(sha256.New, password)
			_, _ = mac.Write(u)
			u = mac.Sum(nil)
			for i := range t {
				t[i] ^= u[i]
			}
		}
		result = append(result, t...)
	}
	return result[:keyLength]
}
