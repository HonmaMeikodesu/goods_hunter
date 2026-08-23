package schedule

import (
	"testing"
	"time"
)

func TestParseAndMatch(t *testing.T) {
	t.Parallel()
	tests := []struct {
		spec  string
		value time.Time
		match bool
	}{
		{"* * * * *", time.Date(2026, 8, 23, 12, 34, 0, 0, time.UTC), true},
		{"*/15 9-17 * * 1-5", time.Date(2026, 8, 24, 9, 30, 0, 0, time.UTC), true},
		{"*/15 9-17 * * 1-5", time.Date(2026, 8, 23, 9, 30, 0, 0, time.UTC), false},
		{"0 0 1 * 0", time.Date(2026, 8, 2, 0, 0, 0, 0, time.UTC), true}, // restricted DOM/DOW use OR
		{"0 0 * * 7", time.Date(2026, 8, 23, 0, 0, 0, 0, time.UTC), true},
	}
	for _, test := range tests {
		test := test
		t.Run(test.spec+test.value.String(), func(t *testing.T) {
			expression, err := Parse(test.spec)
			if err != nil {
				t.Fatalf("Parse() error = %v", err)
			}
			if got := expression.Match(test.value); got != test.match {
				t.Fatalf("Match() = %v, want %v", got, test.match)
			}
		})
	}
}

func TestParseRejectsInvalidExpressions(t *testing.T) {
	t.Parallel()
	for _, spec := range []string{"", "* * * *", "60 * * * *", "*/0 * * * *", "* 24 * * *", "* * 0 * *", "* * * 13 *", "* * * * 8", "1--2 * * * *"} {
		if _, err := Parse(spec); err == nil {
			t.Errorf("Parse(%q) unexpectedly succeeded", spec)
		}
	}
}
