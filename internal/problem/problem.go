package problem

type Code string

func (c Code) Error() string { return string(c) }

const (
	InvalidLogin   Code = "010102"
	ExpiredLogin   Code = "010103"
	WrongPassword  Code = "030301"
	UserExists     Code = "030401"
	InvalidCode    Code = "030402"
	TaskNotFound   Code = "030502"
	TaskPermission Code = "030503"
	DuplicateTask  Code = "030504"
	InvalidRequest Code = "040001"
)
