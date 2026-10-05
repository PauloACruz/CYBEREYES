package agent

import (
	"github.com/pauloacruz/cybereyes/agent/internal/actions"
	"github.com/pauloacruz/cybereyes/agent/internal/care"
	"github.com/pauloacruz/cybereyes/agent/internal/checks"
	"github.com/pauloacruz/cybereyes/agent/internal/choco"
	"github.com/pauloacruz/cybereyes/agent/internal/core"
	"github.com/pauloacruz/cybereyes/agent/internal/inventory"
	"github.com/pauloacruz/cybereyes/agent/internal/logs"
	"github.com/pauloacruz/cybereyes/agent/internal/snmp"
	"github.com/pauloacruz/cybereyes/agent/internal/tasks"
	"github.com/pauloacruz/cybereyes/agent/internal/terminal"
	"github.com/pauloacruz/cybereyes/agent/internal/tray"
	"github.com/pauloacruz/cybereyes/agent/internal/wua"
)

func init() {
	modules = []Module{
		inventory.Register,
		core.Register,
		actions.Register,
		tray.Register,
		terminal.Register,
		wua.Register,
		choco.Register,
		checks.Register,
		tasks.Register,
		logs.Register,
		snmp.Register,
		care.Register,
	}
}
