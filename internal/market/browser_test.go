package market

import (
	"net/url"
	"testing"
)

func TestAuthorizationMatchesAliCloudUtility(t *testing.T) {
	t.Parallel()
	endpoint, err := url.Parse("https://example.aliyuncs.com/2016-08-15/proxy/invokes/$LATEST?qualifier=LATEST&x=a%20b")
	if err != nil {
		t.Fatal(err)
	}
	got := authorization("POST", endpoint, map[string]string{
		"x-acs-date": "2026-08-23T00:00:00.000Z", "content-type": "application/json",
	}, "test-key", "test-secret")
	want := "ACS3-HMAC-SHA256 Credential=test-key,SignedHeaders=content-type;x-acs-date,Signature=e526e825fa7f418c98d130e72ce4f4a0e8f3ef8f0e06f0c8083da00518c8bdaf"
	if got != want {
		t.Fatalf("authorization() = %q, want %q", got, want)
	}
}
