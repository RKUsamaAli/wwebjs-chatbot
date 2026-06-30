import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MenuModule } from 'primeng/menu';
import { MenuItem } from 'primeng/api';
import { AvatarModule } from 'primeng/avatar';

@Component({
  selector: 'app-dashboard-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, MenuModule, AvatarModule],
  templateUrl: './dashboard-layout.html',
  styleUrls: ['./dashboard-layout.scss']
})
export class DashboardLayout implements OnInit {
  items: MenuItem[] = [];

  ngOnInit() {
    this.items = [
      {
        label: 'CRM',
        items: [
          {
            label: 'Inbox',
            icon: 'pi pi-inbox',
            routerLink: '/inbox'
          },
          {
            label: 'Contacts',
            icon: 'pi pi-users',
            routerLink: '/contacts'
          }
        ]
      },
      {
        label: 'Configuration',
        items: [
          {
            label: 'Connect WhatsApp',
            icon: 'pi pi-link',
            routerLink: '/connect'
          }
        ]
      }
    ];
  }
}
