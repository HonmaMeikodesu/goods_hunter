package cipher

import (
	"testing"

	"github.com/HonmaMeikodesu/goods_hunter/internal/problem"
)

func TestPayloadRoundTripAndIntegrity(t *testing.T) {
	t.Parallel()
	module, err := New([]byte("0123456789abcdef0123456789abcdef"))
	if err != nil {
		t.Fatal(err)
	}
	payload, err := module.Encode("mixed 内容")
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := module.Decode(payload)
	if err != nil {
		t.Fatal(err)
	}
	if decoded != "mixed 内容" {
		t.Fatalf("Decode() = %q", decoded)
	}
	payload.Data.Message = "00" + payload.Data.Message[2:]
	if _, err := module.Decode(payload); err != problem.ErrMessageCorrupted {
		t.Fatalf("Decode(corrupt) error = %v, want %v", err, problem.ErrMessageCorrupted)
	}
}
